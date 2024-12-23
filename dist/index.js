import express from "express"; // Import express
import path from "path"; // Import path for static file management
import { fileURLToPath } from "url"; // Import fileURLToPath for dynamic module paths
import session from "express-session"; // Import session management
import bcrypt from "bcrypt"; // Import bcrypt for password hashing
import sqlite3 from "sqlite3"; // Import sqlite3 for database interaction
import dotenv from "dotenv"; // Import dotenv for environment variable management

// Load environment variables from .env file
dotenv.config();

// Initialize Express app
const app = express();

// Get current directory path for dynamic paths (used for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set EJS as the view engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views")); // Ensure 'views' directory is correctly set

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Body parser middleware for parsing POST requests
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session management middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || "defaultSecret", // Session secret from environment variable
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, secure: false }, // Cookie settings
  })
);

// Database connection setup
const dbPath = process.env.DB_PATH || path.join(__dirname, "secrets.db"); // Path to database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database:", err.message);
    process.exit(1); // Exit if database connection fails
  } else {
    console.log("Connected to SQLite database.");
  }
});

// Function to check if a user exists in the database
function checkUserExists(email) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
      if (err) return reject(err);
      resolve(row); // Return user if found
    });
  });
}

// Function to get the count of users who have renewed their permits
function getRenewedCount() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT COUNT(*) AS count FROM users WHERE renewed = TRUE",
      (err, row) => {
        if (err) {
          console.error("Error fetching renewed count:", err);
          return reject(err);
        }
        resolve(row.count); // Return the renewed user count
      }
    );
  });
}

// Middleware to ensure user is logged in
function ensureAuthenticated(req, res, next) {
  if (!req.session.email) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }
  next(); // Proceed to the next middleware/route handler
}

// Route to render login page
app.get("/login", (req, res) => {
  const message = req.query.message || ""; // Get message from query string
  res.render("login", { message }); // Render login.ejs with message
});

// Handle login POST request
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await checkUserExists(email);
    if (!user) {
      return res.redirect("/login?message=No user found");
    }

    const match = await bcrypt.compare(password, user.password); // Compare hashed password
    if (match) {
      req.session.userId = user.id; // Store user id in session
      req.session.email = user.email;
      return res.redirect("/members"); // Redirect to dashboard on successful login
    } else {
      return res.redirect("/login?message=Incorrect password.");
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error during login.");
  }
});

// Route to render registration page
app.get("/register", (req, res) => {
  res.render("register"); // Render the registration page (register.ejs)
});

// Handle registration POST request
app.post("/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  try {
    // Check if user already exists
    const existingUser = await checkUserExists(email);
    if (existingUser) {
      return res.redirect("/register?message=User already exists.");
    }

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user into the database
    db.run(
      "INSERT INTO users (firstName, lastName, email, password) VALUES (?, ?, ?, ?)",
      [firstName, lastName, email, hashedPassword],
      function (err) {
        if (err) {
          console.error("Error registering user:", err.message);
          return res.status(500).send("Error during registration.");
        }
        return res.redirect("/login"); // Redirect to login after successful registration
      }
    );
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error during registration.");
  }
});

// Protected route to show dashboard for logged-in users
app.get("/members", ensureAuthenticated, async (req, res) => {
  try {
    const user = await new Promise((resolve, reject) => {
      db.get(
        "SELECT firstName, lastName, permitType FROM users WHERE email = ?",
        [req.session.email],
        (err, row) => {
          if (err) reject(err);
          resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(404).send("User not found.");
    }

    // Calculate the renewal price based on permit type
    let renewalPrice = 0;
    switch (user.permitType) {
      case "Local Senior":
        renewalPrice = 2000; // £20.00 in cents
        break;
      case "Local Adult":
        renewalPrice = 4000; // £40.00 in cents
        break;
      case "Visiting Adult":
        renewalPrice = 10000; // £100.00 in cents
        break;
      case "Visiting Senior":
        renewalPrice = 5000; // £50.00 in cents
        break;
      default:
        renewalPrice = 0;
        break;
    }

    // Determine whether to display the payment option
    const displayPaymentOption = renewalPrice > 0;

    // Get the count of users who have renewed their permits
    const renewedCount = await getRenewedCount();

    // Render the 'members' page and pass the necessary variables
    res.render("members", {
      firstName: user.firstName,
      lastName: user.lastName,
      permitType: user.permitType,
      renewalPrice: (renewalPrice / 100).toFixed(2), // Convert cents to pounds
      renewedCount,
      displayPaymentOption,
    });
  } catch (err) {
    console.error("Error fetching user data:", err);
    return res.status(500).send("Error fetching user data.");
  }
});

// Logout route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Error during logout:", err);
      return res.status(500).send("Error during logout.");
    }
    res.redirect("/login"); // Redirect to login after logout
  });
});

// Home route (default route to login page)
app.get("/", (req, res) => {
  res.redirect("/login");
});

// Start the server
const port = process.env.PORT || 3001; // Default to port 3001
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
