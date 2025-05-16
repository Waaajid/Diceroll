import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.get('/', (req, res) => res.send('Mind Meld server running!'));

const WORDS = [
  'London',
  'Kitchen',
  'Fruits',
  'Countries',
  'Alphabets'
];

// In-memory game state
const games = {};

function getRandomWord() {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

io.on('connection', (socket) => {
  socket.on('join', ({ room, team, player }) => {
    socket.join(room);
    if (!games[room]) {
      games[room] = { teams: {}, round: 0, prompt: '', submissions: {}, scores: {}, dice: null, fridayOff: false };
    }
    if (!games[room].teams[team]) games[room].teams[team] = [];
    if (!games[room].teams[team].includes(player)) games[room].teams[team].push(player);
    socket.data = { room, team, player };
    io.to(room).emit('state', games[room]);
  });

  socket.on('start', (room) => {
    if (!games[room]) return;
    games[room].round++;
    games[room].prompt = getRandomWord();
    games[room].submissions = {};
    games[room].dice = null;
    games[room].fridayOff = false;
    io.to(room).emit('new-round', games[room]);
  });

  socket.on('submit', ({ word }) => {
    const { room, team, player } = socket.data;
    if (!games[room] || !games[room].teams[team]) return;
    if (!games[room].submissions[team]) games[room].submissions[team] = {};
    games[room].submissions[team][player] = word.trim().toLowerCase();
    // Check if all players in team have submitted
    if (Object.keys(games[room].submissions[team]).length === games[room].teams[team].length) {
      // Score: count most common word
      const words = Object.values(games[room].submissions[team]);
      const counts = words.reduce((a, w) => (a[w] = (a[w] || 0) + 1, a), {});
      const max = Math.max(...Object.values(counts));
      games[room].scores[team] = (games[room].scores[team] || 0) + max;
      io.to(room).emit('team-scored', { team, score: games[room].scores[team] });
      // If all teams submitted, allow dice roll
      const allTeamsSubmitted = Object.keys(games[room].teams).every(
        t => games[room].submissions[t] && Object.keys(games[room].submissions[t]).length === games[room].teams[t].length
      );
      if (allTeamsSubmitted) {
        // Find top team
        const top = Object.entries(games[room].scores).sort((a, b) => b[1] - a[1])[0][0];
        io.to(room).emit('can-roll-dice', { team: top });
      }
    }
  });

  socket.on('roll-dice', () => {
    const { room, team } = socket.data;
    if (!games[room]) return;
    // Only top team can roll
    const top = Object.entries(games[room].scores).sort((a, b) => b[1] - a[1])[0][0];
    if (team !== top) return;
    const roll = Math.floor(Math.random() * 6) + 1;
    games[room].dice = roll;
    if (roll === 6) games[room].fridayOff = true;
    io.to(room).emit('dice-rolled', { team, roll, fridayOff: games[room].fridayOff });
  });

  socket.on('disconnect', () => {
    const { room, team, player } = socket.data || {};
    if (room && team && player && games[room] && games[room].teams[team]) {
      games[room].teams[team] = games[room].teams[team].filter(p => p !== player);
      if (games[room].teams[team].length === 0) delete games[room].teams[team];
      io.to(room).emit('state', games[room]);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
