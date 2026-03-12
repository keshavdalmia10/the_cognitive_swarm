import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as createClient, Socket } from 'socket.io-client';

test('direction suggestions broadcast to many participants', async (t) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const address = httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const participantCount = 40;
  const clients: Socket[] = [];

  await Promise.all(
    Array.from({ length: participantCount }, async () => {
      await new Promise<void>((resolve, reject) => {
        const client = createClient(baseUrl, {
          transports: ['websocket'],
          reconnection: false,
        });

        const onError = (error: Error) => {
          client.off('connect', onConnect);
          reject(error);
        };
        const onConnect = () => {
          client.off('connect_error', onError);
          clients.push(client);
          resolve();
        };

        client.once('connect_error', onError);
        client.once('connect', onConnect);
      });
    }),
  );

  const payload = {
    suggestion: 'Test a counterexample from the least represented student group.',
    rationale: 'Broadens the class discussion beyond the dominant lens.',
    reason: 'auto',
    createdAt: Date.now(),
  };

  const waitForBroadcast = (client: Socket, expectedPayload: typeof payload) =>
    new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timed out waiting for suggestion on client ${client.id}`));
      }, 3000);

      client.once('direction_suggestion', (received) => {
        clearTimeout(timeout);
        assert.deepEqual(received, expectedPayload);
        resolve();
      });
    });

  const broadcastReceipts = Promise.all(clients.map((client) => waitForBroadcast(client, payload)));
  io.emit('direction_suggestion', payload);
  await broadcastReceipts;

  const disconnected = clients.pop();
  assert.ok(disconnected);
  disconnected.disconnect();

  const secondPayload = {
    suggestion: 'Ask what constraints the class has not named yet.',
    rationale: 'Surfaces hidden assumptions before converging.',
    reason: 'manual',
    createdAt: Date.now(),
  };

  const secondBroadcastReceipts = Promise.all(clients.map((client) => waitForBroadcast(client, secondPayload)));
  io.emit('direction_suggestion', secondPayload);
  await secondBroadcastReceipts;

  for (const client of clients) {
    client.disconnect();
  }
  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
  if (httpServer.listening) {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
