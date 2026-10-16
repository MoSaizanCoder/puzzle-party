import { useEffect, useRef, useState } from 'react';

// Add playerCount to the parameters
export default function useVoiceChat(socket, localPlayerId, isMicMuted, isSpeakerMuted, playerCount) {
  const [streams, setStreams] = useState({});
  const localStream = useRef(null);
  const peers = useRef({});
  const pendingCandidates = useRef({});
  const signalQueue = useRef([]);
  const [isReady, setIsReady] = useState(false);

  // 1 & 2. Hardware Sync (Stop tracks to kill browser light)
  useEffect(() => {
    let isMounted = true;

    if (!socket) return; 

    // If muted OR if the player is alone in the lobby, kill the hardware
    if (isMicMuted || playerCount <= 1) {
      if (localStream.current) {
        localStream.current.getTracks().forEach(track => track.stop());
        localStream.current = null;
      }
      
      Object.values(peers.current).forEach(peer => {
        if (peer && typeof peer.getSenders === 'function') {
          peer.getSenders().forEach(sender => {
            if (sender.track?.kind === 'audio' || !sender.track) {
              sender.replaceTrack(null).catch(() => {});
            }
          });
        }
      });
      
      console.log('🎤 Microphone hardware STOPPED (Muted or Alone)');
      if (!isReady) setIsReady(true);
    } else {
      // Re-acquire hardware (Browser remembers permission, so no prompt!)
      navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then((stream) => {
          if (!isMounted) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }
          localStream.current = stream;
          
          // Restore the active hardware track to the network
          const audioTrack = stream.getAudioTracks()[0];
          Object.values(peers.current).forEach(peer => {
            if (peer && typeof peer.getSenders === 'function') {
              peer.getSenders().forEach(sender => {
                if (sender.track?.kind === 'audio' || !sender.track) {
                  sender.replaceTrack(audioTrack).catch(() => {});
                }
              });
            }
          });
          
          console.log('🎤 Microphone hardware RE-ACQUIRED (Browser light on)');
          if (!isReady) setIsReady(true);
        })
        .catch(err => {
          console.error('Mic access denied:', err);
          if (!isReady) setIsReady(true);
        });
    }

    return () => {
      isMounted = false;
    };
  }, [isMicMuted, socket]);

  // 3. WebRTC Signaling Logic
  useEffect(() => {
    if (!socket?.connected || !localPlayerId) return;

    const createPeer = (targetId, initiator) => {
      if (peers.current[targetId]) return peers.current[targetId];

      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peers.current[targetId] = peer;
      pendingCandidates.current[targetId] = [];

      if (localStream.current) {
        localStream.current.getTracks().forEach(track => {
          peer.addTrack(track, localStream.current);
        });
      } else {
        // If starting muted, add a dummy transceiver so we have a sender to replace later
        peer.addTransceiver('audio', { direction: 'sendrecv' });
      }

      peer.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_signal', { targetId, signal: { type: 'candidate', candidate: event.candidate } });
        }
      };

      peer.ontrack = (event) => {
        console.log(`🔊 Receiving audio track from ${targetId}`);
        setStreams(prev => ({ ...prev, [targetId]: event.streams[0] }));
      };

      peer.onconnectionstatechange = () => {
        console.log(`📡 Peer ${targetId} state:`, peer.connectionState);
      };

      if (initiator) {
        peer.createOffer().then(offer => {
          peer.setLocalDescription(offer);
          socket.emit('webrtc_signal', { targetId, signal: offer });
        });
      }
      return peer;
    };

    const processSignal = async (senderId, signal) => {
      let peer = peers.current[senderId];
      if (!peer) peer = createPeer(senderId, false);

      try {
        if (signal.type === 'offer') {
          await peer.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          socket.emit('webrtc_signal', { targetId: senderId, signal: answer });
          
          pendingCandidates.current[senderId].forEach(c => peer.addIceCandidate(c));
          pendingCandidates.current[senderId] = [];
          
        } else if (signal.type === 'answer') {
          await peer.setRemoteDescription(new RTCSessionDescription(signal));
          
          pendingCandidates.current[senderId].forEach(c => peer.addIceCandidate(c));
          pendingCandidates.current[senderId] = [];
          
        } else if (signal.type === 'candidate') {
          const candidate = new RTCIceCandidate(signal.candidate);
          if (peer.remoteDescription) {
            await peer.addIceCandidate(candidate);
          } else {
            pendingCandidates.current[senderId].push(candidate);
          }
        }
      } catch (err) {
        console.error('WebRTC Handshake Error:', err);
      }
    };

    const handleSignal = (data) => {
      if (!localStream.current) {
        signalQueue.current.push(data);
        return;
      }
      processSignal(data.senderId, data.signal);
    };

    const handleGameState = (state) => {
      if (!localStream.current) return; 

      const incomingIds = Object.keys(state.players).filter(id => id !== localPlayerId);
      
      Object.keys(peers.current).forEach(existingId => {
        if (!state.players[existingId]) {
          console.log(`🧹 Cleaning up disconnected peer: ${existingId}`);
          peers.current[existingId].close();
          delete peers.current[existingId];
          delete pendingCandidates.current[existingId];
          setStreams(prev => {
            const next = { ...prev };
            delete next[existingId];
            return next;
          });
        }
      });

      incomingIds.forEach(id => {
        if (!peers.current[id] && localPlayerId > id) {
          createPeer(id, true);
        }
      });
    };

    socket.on('webrtc_signal', handleSignal);
    socket.on('game_state', handleGameState);

    if (isReady) {
      signalQueue.current.forEach(handleSignal);
      signalQueue.current = [];
      
      socket.emit('toggle_ready');
      socket.emit('toggle_ready'); 
    }

    return () => {
      socket.off('webrtc_signal', handleSignal);
      socket.off('game_state', handleGameState);
    };
  }, [socket, localPlayerId, isReady]);

  // 4. Return Audio Elements
  return Object.entries(streams).map(([peerId, stream]) => (
    <audio 
      key={peerId} 
      autoPlay 
      playsInline
      muted={isSpeakerMuted} 
      ref={el => { 
        if (el && el.srcObject !== stream) { 
          el.srcObject = stream; 
          el.play().catch(e => console.warn(`🛑 Autoplay blocked for ${peerId}.`, e));
        } 
      }} 
    />
  ));
}