import express from "express";
import { createServer as createViteServer } from "vite";
import { Server } from "socket.io";
import http from "http";

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Global State for the Swarm
  let state = {
    topic: 'Schema Design',
    phase: 'divergent', // 'divergent' | 'convergent' | 'forging'
    ideas: [] as { id: string, text: string, weight: number, cluster: string, authorId: string, authorName: string }[],
    mermaidCode: "graph TD;\n  Swarm[The Swarm] --> Ideas[Ideas];",
  };

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    
    // Send initial state
    socket.emit("state_sync", state);

    // Update topic
    socket.on("set_topic", (topic: string) => {
      state.topic = topic;
      io.emit("topic_updated", state.topic);
    });

    // Ingestion Task: Receive new ideas from clients (extracted via Gemini)
    socket.on("add_idea", (idea: { text: string, cluster: string, authorName?: string }) => {
      const newIdea = {
        id: Math.random().toString(36).substring(2, 9),
        text: idea.text,
        weight: 1, // Initial weight
        cluster: idea.cluster || 'General',
        authorId: socket.id,
        authorName: idea.authorName || 'Anonymous Node'
      };
      state.ideas.push(newIdea);
      io.emit("idea_added", newIdea);
    });

    // Consensus Mediator Task: Quadratic Voting
    socket.on("vote_idea", (data: { ideaId: string, tokens: number }) => {
      const idea = state.ideas.find(i => i.id === data.ideaId);
      if (idea) {
        // Quadratic voting: cost = tokens^2, but we just add the raw tokens for simplicity in this demo
        idea.weight += data.tokens;
        io.emit("idea_updated", idea);
      }
    });

    // Visual Scribe Task: Update Mermaid Diagram
    socket.on("update_mermaid", (code: string) => {
      state.mermaidCode = code;
      io.emit("mermaid_updated", state.mermaidCode);
    });

    // Phase transition
    socket.on("set_phase", (phase: string) => {
      state.phase = phase;
      io.emit("phase_changed", state.phase);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
