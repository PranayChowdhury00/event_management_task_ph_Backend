const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(cors({
  origin: ['http://localhost:5173'],
  credentials: true // Allow cookies to be sent
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
    // await client.connect();
    const userCollection = client.db("eventDB").collection("users");

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
app.listen(port, () => {
  console.log('Server is running at', port);
});