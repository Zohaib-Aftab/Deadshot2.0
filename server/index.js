const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// In-memory player state
// Keyed by socket.id -> { id, nickname, position: {x, y, z}, rotation: {x, y, z}, health, maxHealth }
const players = {};

// Spawn points across the map
const spawnPoints = [
  { x: 0, y: 1.6, z: 0 },
  { x: 14, y: 1.6, z: 14 },
  { x: -14, y: 1.6, z: -14 },
  { x: 14, y: 1.6, z: -14 },
  { x: -14, y: 1.6, z: 14 },
  { x: 0, y: 1.6, z: 18 },
  { x: 0, y: 1.6, z: -18 },
  { x: 18, y: 1.6, z: 0 },
  { x: -18, y: 1.6, z: 0 }
];

function getRandomSpawn() {
  return spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
}

// Find a safe spawn point furthest away from other active players
function getSafeSpawn(excludingPlayerId) {
  const activePositions = Object.values(players)
    .filter(p => p.id !== excludingPlayerId && p.health > 0)
    .map(p => p.position);

  if (activePositions.length === 0) {
    return getRandomSpawn();
  }

  let bestSpawn = spawnPoints[0];
  let maxMinDist = -1;

  for (const sp of spawnPoints) {
    let minDist = Infinity;
    for (const pos of activePositions) {
      const d = Math.hypot(sp.x - pos.x, sp.z - pos.z);
      if (d < minDist) minDist = d;
    }
    if (minDist > maxMinDist) {
      maxMinDist = minDist;
      bestSpawn = sp;
    }
  }
  return bestSpawn;
}

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    server: 'MyFPSGame Server',
    connectedPlayers: Object.keys(players).length,
    players
  });
});

io.on('connection', (socket) => {
  console.log(`[CONNECT] Player connected: ${socket.id}`);

  const spawn = getRandomSpawn();

  // Initialize new player state with 100 HP
  players[socket.id] = {
    id: socket.id,
    nickname: `Player_${socket.id.substring(0, 4)}`,
    position: { x: spawn.x, y: spawn.y, z: spawn.z },
    rotation: { x: 0, y: 0, z: 0 },
    health: 100,
    maxHealth: 100,
    kills: 0,
    deaths: 0
  };

  // Send current players to the newly connected player
  socket.emit('currentPlayers', players);

  // Notify other players about the new joiner
  socket.broadcast.emit('playerJoined', players[socket.id]);

  // Set or update nickname
  socket.on('setNickname', (nickname) => {
    if (players[socket.id]) {
      const cleanNick = (typeof nickname === 'string' && nickname.trim()) 
        ? nickname.trim().substring(0, 16) 
        : `Player_${socket.id.substring(0, 4)}`;
      players[socket.id].nickname = cleanNick;
      console.log(`[NICKNAME] ${socket.id} set nickname to "${cleanNick}"`);
      io.emit('playerUpdated', players[socket.id]);
    }
  });

  // Handle position & rotation updates
  socket.on('playerMove', (data) => {
    const player = players[socket.id];
    if (!player) return;

    if (data.position) {
      player.position.x = Number(data.position.x) || player.position.x;
      player.position.y = Number(data.position.y) || player.position.y;
      player.position.z = Number(data.position.z) || player.position.z;
    } else {
      if (data.x !== undefined) player.position.x = Number(data.x);
      if (data.y !== undefined) player.position.y = Number(data.y);
      if (data.z !== undefined) player.position.z = Number(data.z);
    }

    if (data.rotation) {
      if (typeof data.rotation === 'object') {
        player.rotation.x = Number(data.rotation.x) || 0;
        player.rotation.y = Number(data.rotation.y) || 0;
        player.rotation.z = Number(data.rotation.z) || 0;
      } else {
        player.rotation.y = Number(data.rotation) || 0;
      }
    } else if (data.rotationY !== undefined) {
      player.rotation.y = Number(data.rotationY) || 0;
    }

    // Broadcast updated movement to other players immediately
    socket.broadcast.emit('playerMoved', {
      id: socket.id,
      position: player.position,
      rotation: player.rotation
    });
  });

  // Handle hit & damage dealt to a player (Head: 60, Body/Arms: 40, Legs: 30)
  function handleHit({ targetId, part, damage, shooterId }) {
    const target = players[targetId];
    if (!target || target.health <= 0) return;

    const shooter = players[shooterId || socket.id];

    // Determine damage based on hit part
    const hitPart = (part || 'body').toLowerCase();
    let appliedDamage = 40;
    if (hitPart === 'head') {
      appliedDamage = 60;
    } else if (hitPart === 'legs') {
      appliedDamage = 30;
    } else {
      appliedDamage = 40; // Body / Arms
    }

    target.health = Math.max(0, target.health - appliedDamage);

    console.log(`[HIT] ${shooter?.nickname || 'Unknown'} hit ${target.nickname} in ${hitPart.toUpperCase()} for ${appliedDamage} dmg. HP: ${target.health}/100`);

    // Broadcast updated health to all clients in real time
    io.emit('playerHealthUpdated', {
      id: targetId,
      health: target.health,
      damage: appliedDamage,
      part: hitPart,
      shooterId: shooter?.id || socket.id
    });

    io.emit('playerDamaged', {
      id: targetId,
      health: target.health,
      damage: appliedDamage,
      shooterId: shooter?.id || socket.id
    });

    // Check if player health reached 0
    if (target.health <= 0) {
      const isHeadshot = (hitPart === 'head');

      if (shooter) {
        shooter.kills = (shooter.kills || 0) + 1;
      }
      target.deaths = (target.deaths || 0) + 1;

      console.log(`[ELIMINATED] ${target.nickname} was eliminated by ${shooter?.nickname || 'Unknown'} (${isHeadshot ? 'HEADSHOT' : 'BODY'})`);

      // Broadcast kill notification to all connected clients
      io.emit('killNotification', {
        killerId: shooter?.id || socket.id,
        killerName: shooter?.nickname || 'Player',
        killerKills: shooter ? shooter.kills : 1,
        victimId: targetId,
        victimName: target.nickname,
        part: hitPart,
        isHeadshot: isHeadshot
      });

      io.emit('playerKilled', {
        victimId: targetId,
        killerId: shooter?.id || socket.id
      });

      // Respawn the defeated player at a random safe spawn point with 100 HP after 2 seconds
      setTimeout(() => {
        if (players[targetId]) {
          const safeSpawn = getSafeSpawn(targetId);
          players[targetId].health = 100;
          players[targetId].position = { x: safeSpawn.x, y: safeSpawn.y, z: safeSpawn.z };
          players[targetId].rotation = { x: 0, y: 0, z: 0 };
          console.log(`[SAFE RESPAWN] ${players[targetId].nickname} respawned with 100 HP at (${safeSpawn.x}, ${safeSpawn.z})`);

          io.emit('playerRespawned', players[targetId]);
          io.emit('playerHealthUpdated', {
            id: targetId,
            health: 100,
            damage: 0,
            part: 'respawn',
            shooterId: null
          });
        }
      }, 2000); // 2-second respawn delay
    }
  }

  socket.on('playerHit', handleHit);
  socket.on('playerDamage', handleHit);

  // Handle disconnection
  socket.on('disconnect', () => {
    const disconnectedPlayer = players[socket.id];
    console.log(`[DISCONNECT] Player disconnected: ${socket.id} (${disconnectedPlayer?.nickname || 'Unknown'})`);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Periodic state broadcast (30Hz) to keep all clients perfectly synchronized
setInterval(() => {
  if (Object.keys(players).length > 0) {
    io.emit('stateUpdate', players);
  }
}, 1000 / 30);

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`FPS Multiplayer Server running on port ${PORT}`);
  console.log(`- Socket.IO & CORS enabled`);
  console.log(`- Real-time position/rotation/health tracking`);
  console.log(`===============================================`);
});
