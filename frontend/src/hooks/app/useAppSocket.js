import { useCallback, useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import { SOCKET_ENDPOINT } from '../../runtimeConfig';

const SOCKET_OPTIONS = {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5,
  timeout: 20000,
  autoConnect: true
};

const useAppSocket = ({
  setAuthenticated,
  setNodes,
  setTechnologies
}) => {
  const socketRef = useRef(null);
  const [socket, setSocket] = useState(null);

  const cleanupSocket = useCallback(() => {
    if (!socketRef.current) {
      setSocket(null);
      return;
    }

    socketRef.current.removeAllListeners();
    socketRef.current.close();
    socketRef.current = null;
    setSocket(null);
  }, []);

  const initializeSocket = useCallback((token = null) => {
    cleanupSocket();

    const nextSocket = io(SOCKET_ENDPOINT, SOCKET_OPTIONS);

    nextSocket.on('connect', () => {
      console.log('WebSocket 连接成功:', nextSocket.id);
      const authToken = token || localStorage.getItem('token');
      if (authToken) {
        nextSocket.emit('authenticate', authToken);
        setTimeout(() => {
          nextSocket.emit('getGameState');
        }, 200);
      }

      if (token) {
        setTimeout(() => {
          nextSocket.emit('getGameState');
        }, 300);
      }
    });

    nextSocket.on('connect_error', (error) => {
      console.error('WebSocket 连接错误:', error);
    });

    nextSocket.on('disconnect', (reason) => {
      console.log('WebSocket 断开连接:', reason);
    });

    nextSocket.on('authenticated', () => {
      console.log('认证成功');
      setAuthenticated(true);
      nextSocket.emit('getGameState');
    });

    nextSocket.on('gameState', (data) => {
      console.log('收到游戏状态:', data);
      const approvedNodes = (data.nodes || []).filter((node) => node.status === 'approved');
      setNodes(approvedNodes);
    });

    nextSocket.on('nodeCreated', (node) => {
      if (node.status === 'approved') {
        setNodes((prev) => [...prev, node]);
      }
    });

    nextSocket.on('techUpgraded', (tech) => {
      setTechnologies((prev) => {
        const existing = prev.find((item) => item.techId === tech.techId);
        if (existing) {
          return prev.map((item) => (item.techId === tech.techId ? tech : item));
        }
        return [...prev, tech];
      });
    });

    nextSocket.on('resourcesUpdated', () => {
      nextSocket.emit('getGameState');
    });

    nextSocket.on('knowledgePointUpdated', (updatedNodes) => {
      setNodes((prevNodes) => {
        const updatedNodeMap = new Map();
        updatedNodes.forEach((node) => updatedNodeMap.set(node._id, node));

        return prevNodes.map((node) => {
          const updatedNode = updatedNodeMap.get(node._id);
          if (updatedNode) {
            return {
              ...node,
              knowledgePoint: updatedNode.knowledgePoint
            };
          }
          return node;
        });
      });
    });

    socketRef.current = nextSocket;
    setSocket(nextSocket);
    return nextSocket;
  }, [cleanupSocket, setAuthenticated, setNodes, setTechnologies]);

  useEffect(() => {
    initializeSocket();
    return cleanupSocket;
  }, [cleanupSocket, initializeSocket]);

  return {
    socket,
    initializeSocket,
    cleanupSocket
  };
};

export default useAppSocket;
