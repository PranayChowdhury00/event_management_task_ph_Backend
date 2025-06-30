const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();
const moment = require('moment');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(cors({
  origin: ['http://localhost:5173'
   ,'https://event-management-task-ph.vercel.app',
  ],
  credentials: true 
}));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-here',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.50gak.mongodb.net/eventDB?retryWrites=true&w=majority`,
    collectionName: 'sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.50gak.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const userCollection = client.db("eventDB").collection("users");
   const eventsCollection = client.db("eventDB").collection("events");
    // User registration
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.status(400).send({ message: "Email already exists" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Get all users (for testing, remove in production)
    app.get('/users', async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // Login endpoint
    app.post('/login', async (req, res) => {
      const { email, password } = req.body;
      const user = await userCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: "No account found. Please register first." });
      }

      if (user.password !== password) {
        return res.status(401).send({ message: "Incorrect password." });
      }

      // Store user in session (without password)
      req.session.user = {
        _id: user._id,
        name: user.name,
        email: user.email,
        photoURL: user.photoURL
      };

      res.send({ message: "Login successful", user: req.session.user });
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
      req.session.destroy(err => {
        if (err) {
          return res.status(500).send({ message: "Logout failed" });
        }
        res.clearCookie('connect.sid');
        res.send({ message: "Logout successful" });
      });
    });

    // Check auth status
    app.get('/check-auth', (req, res) => {
      if (req.session.user) {
        return res.send({ authenticated: true, user: req.session.user });
      }
      res.send({ authenticated: false });
    });

    // Protected route example
    app.get('/protected', (req, res) => {
      if (!req.session.user) {
        return res.status(401).send({ message: "Not authenticated" });
      }
      res.send({ message: "This is protected data", user: req.session.user });
    });

    // Add Event endpoint
app.post('/events', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: "Not authenticated" });
  }

  try {
    const event = {
      title: req.body.title,
      name: req.body.name,
      dateTime: req.body.dateTime, 
      location: req.body.location,
      description: req.body.description,
      attendeeCount: parseInt(req.body.attendeeCount) || 0,
      createdBy: req.session.user._id.toString(),
      createdAt: new Date()
    };

    const result = await eventsCollection.insertOne(event);
    res.status(201).send(result);
  } catch (err) {
    console.error("Error adding event:", err);
    res.status(500).send({ message: "Failed to add event" });
  }
});

// Get events (for testing)
app.get('/events', async (req, res) => {
  try {
    const events = await eventsCollection.find().sort({ dateTime: -1 }).toArray();
    res.send(events);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).send({ message: "Failed to fetch events" });
  }
});


// Get user's events
app.get('/my-events', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: "Not authenticated" });
  }

  try {
    const events = await eventsCollection.find({ 
      createdBy: req.session.user._id.toString() 
    }).sort({ dateTime: -1 }).toArray();
    res.send(events);
  } catch (err) {
    console.error("Error fetching user's events:", err);
    res.status(500).send({ message: "Failed to fetch events" });
  }
});

// Update event

app.patch('/events/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: "Not authenticated" });
  }

  try {
    const eventId = req.params.id;
    const { date, time, ...rest } = req.body;
    
   
    const updates = {
      ...rest,
      updatedAt: new Date()
    };

    if (date && time) {
      updates.dateTime = new Date(`${date}T${time}`).toISOString();
    }

   
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, v]) => v !== undefined)
    );

    const result = await eventsCollection.findOneAndUpdate(
      { _id: new ObjectId(eventId), createdBy: req.session.user._id.toString() },
      { $set: filteredUpdates },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).send({ message: "Event not found or not authorized" });
    }

    res.send(result.value);
  } catch (err) {
    console.error("Error updating event:", err);
    res.status(500).send({ message: "Failed to update event" });
  }
});

// Delete event
app.delete('/events/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).send({ message: "Not authenticated" });
  }

  try {
    const eventId = req.params.id;
    const result = await eventsCollection.findOneAndDelete({
      _id: new ObjectId(eventId),
      createdBy: req.session.user._id.toString()
    });

    if (!result.value) {
      return res.status(404).send({ message: "Event not found or not authorized" });
    }

    res.send({ message: "Event deleted successfully" });
  } catch (err) {
    console.error("Error deleting event:", err);
    res.status(500).send({ message: "Failed to delete event" });
  }
});




app.get('/events/filter', async (req, res) => {
  const { title, startDate, endDate } = req.query;
  const query = {};

  if (title) {
    query.title = { $regex: title, $options: 'i' };
  }

  if (startDate || endDate) {
    query.dateTime = {};
    
    if (startDate) {
      // Convert YYYY-MM-DD to start of day in ISO format
      const start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
      query.dateTime.$gte = start.toISOString(); // Compare as ISO string
    }
    
    if (endDate) {
      // Convert YYYY-MM-DD to end of day in ISO format
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      query.dateTime.$lte = end.toISOString(); // Compare as ISO string
    }
  }

  try {
    const events = await eventsCollection.find(query)
      .sort({ dateTime: 1 }) // Sort by the ISO string
      .toArray();
      
    res.send(events);
  } catch (error) {
    console.error("Filter fetch failed", error);
    res.status(500).send({ message: "Failed to fetch filtered events" });
  }
});




app.post('/events/:id/join', async (req, res) => {
  if (!req.session.user) return res.status(401).send({ message: "Not authenticated" });

  const eventId = req.params.id;
  const userId = req.session.user._id.toString();

  try {
    const event = await eventsCollection.findOne({ _id: new ObjectId(eventId) });

    if (!event) return res.status(404).send({ message: "Event not found" });
    if (event.joinedUsers?.includes(userId)) {
      return res.status(400).send({ message: "You already joined this event" });
    }

    const result = await eventsCollection.updateOne(
      { _id: new ObjectId(eventId) },
      {
        $inc: { attendeeCount: 1 },
        $push: { joinedUsers: userId }
      }
    );

    res.send({ message: "Joined event successfully", result });
  } catch (err) {
    console.error("Join error:", err);
    res.status(500).send({ message: "Join failed" });
  }
});













    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from my server');
});

// Start server
// app.listen(port, () => {
//   console.log('Server is running at', port);
// });