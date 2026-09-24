import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createServer } from 'http';

// Routes
import authRoutes from './routes/auth';
import locationRoutes from './routes/locations';
import itemRoutes from './routes/items';
import stockRoutes from './routes/stock';
import countRoutes from './routes/counts';
import transferRoutes from './routes/transfers';
import pickerRoutes from './routes/picker';
import auditRoutes from './routes/audit';
import deviceRoutes from './routes/devices';

// Middleware
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { auditLog } from './middleware/auditLog';

dotenv.config();

const app: Express = express();
const server = createServer(app);

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/locations', authMiddleware, locationRoutes);
app.use('/api/items', authMiddleware, itemRoutes);
app.use('/api/stock', authMiddleware, stockRoutes);
app.use('/api/counts', authMiddleware, countRoutes);
app.use('/api/transfers', authMiddleware, transferRoutes);
app.use('/api/picker', authMiddleware, pickerRoutes);
app.use('/api/audit', authMiddleware, auditRoutes);
app.use('/api/devices', authMiddleware, deviceRoutes);

// Error handler (must be last)
app.use(errorHandler);

// WebSocket Server for real-time updates
const wss = new WebSocket.Server({ server });
const clients = new Map<string, WebSocket>();

wss.on('connection', (ws: WebSocket, req) => {
  const token = new URL(`ws://${req.headers.host}${req.url}`).searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log('WebSocket client connected');

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connection_established',
    timestamp: Date.now(),
  }));

  // Handle messages
  ws.on('message', (data: string) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      } else if (message.type === 'subscribe') {
        // Client subscribed to channel
        console.log(`Client subscribed to ${message.channel}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Broadcast to all connected clients
export function broadcastEvent(event: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        ...event,
        timestamp: Date.now(),
      }));
    }
  });
}

// Start server
const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`🔌 WebSocket server on ws://localhost:${PORT}`);
  console.log(`📊 Health check: GET http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;
