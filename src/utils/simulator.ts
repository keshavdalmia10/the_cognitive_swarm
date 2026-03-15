import { io, Socket } from 'socket.io-client';

const erIdeas = [
  { text: "Entity: STUDENT (student_id, name, email, dob)", cluster: "Entity" },
  { text: "Entity: COURSE (course_code, title, credits)", cluster: "Entity" },
  { text: "Entity: PROFESSOR (emp_id, name, office)", cluster: "Entity" },
  { text: "Entity: DEPARTMENT (dept_id, name)", cluster: "Entity" },
  { text: "Entity: ENROLLMENT (enrollment_id, grade, date)", cluster: "Entity" },
  { text: "Relationship: STUDENT makes ENROLLMENT", cluster: "Relationship" },
  { text: "Relationship: COURSE has ENROLLMENT", cluster: "Relationship" },
  { text: "Relationship: PROFESSOR teaches COURSE", cluster: "Relationship" },
  { text: "Relationship: PROFESSOR belongs_to DEPARTMENT", cluster: "Relationship" },
  { text: "Relationship: COURSE offered_by DEPARTMENT", cluster: "Relationship" },
];

export function startSimulation(numClients = 5, roomCode: string): () => void {
  console.log(`Starting ER Diagram simulation with ${numClients} virtual students in room ${roomCode}...`);
  const sockets: Socket[] = Array.from({ length: numClients }).map(() => io({
    transports: ['websocket'],
  }));

  let globalIdeas: any[] = [];
  let globalTopic = '';
  let ideaIndex = 0;

  sockets.forEach((socket, i) => {
    const fakeNames = ["Ada", "Alan", "Grace", "Linus", "Tim", "Margaret"];
    const simName = `Sim-${fakeNames[i % fakeNames.length]}-${i + 1}`;

    socket.on('connect', () => {
      socket.emit('join_room', { roomCode, userName: simName });
    });

    socket.on('state_sync', (payload) => {
      globalIdeas = payload.state.ideas;
      globalTopic = payload.state.topic;
    });

    socket.on('topic_updated', (topic) => {
      globalTopic = topic;
    });

    socket.on('ideas_batch_added', (newIdeas: any[]) => {
      newIdeas.forEach(idea => {
        if (!globalIdeas.find(existing => existing.id === idea.id)) {
          globalIdeas.push(idea);
        }
      });
    });

    socket.on('ideas_batch_updated', (updatedIdeas: any[]) => {
      updatedIdeas.forEach(updatedIdea => {
        const index = globalIdeas.findIndex(idea => idea.id === updatedIdea.id);
        if (index !== -1) {
          globalIdeas[index] = updatedIdea;
        }
      });
    });

    // Randomly add ideas from the erIdeas list
    const ideaInterval = setInterval(() => {
      // 15% chance every 2 seconds per client to add an idea
      if (Math.random() > 0.85 && ideaIndex < erIdeas.length) { 
        // We use a shared index to ensure all ideas get proposed eventually without too many duplicates
        const idea = erIdeas[ideaIndex % erIdeas.length];
        ideaIndex++; 
        if (idea) {
            socket.emit('add_idea', { text: idea.text, cluster: idea.cluster, authorName: simName });
        }
      }
    }, 2000);

    // Randomly vote on existing ideas
    const voteInterval = setInterval(() => {
      // 40% chance every 1 second per client to vote
      if (globalIdeas.length > 0 && Math.random() > 0.6) {
        const randomIdea = globalIdeas[Math.floor(Math.random() * globalIdeas.length)];
        socket.emit('update_idea_weight', { ideaId: randomIdea.id, weightChange: 1 });
      }
    }, 1000);

    // Store intervals on the socket object for cleanup
    (socket as any).intervals = [ideaInterval, voteInterval];
  });

  // Return a cleanup function to stop the simulation
  return () => {
    console.log("Stopping simulation...");
    sockets.forEach(s => {
      const intervals = (s as any).intervals;
      if (intervals) {
        intervals.forEach(clearInterval);
      }
      s.disconnect();
    });
  };
}
