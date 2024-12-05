import express from "express";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import session from "express-session";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import sanitizeHtml from "sanitize-html";
import { Stripe } from "stripe"; // Use ES module import syntax

// Load environment variables from .env file
dotenv.config(); // If using dotenv to load environment variables
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
}); // Correct way to instantiate Stripe with the secret key

// Validate critical environment variables
if (!process.env.DB_PATH || !process.env.PORT || !process.env.SESSION_SECRET) {
  console.error("Missing environment variables. Please check your .env file.");
  process.exit(1); // Exit the application if critical environment variables are missing
}

// Initialize app and SQLite database
const app = express();
const port = process.env.PORT;
const saltRounds = 12;
const dbPath = process.env.DB_PATH;

// Initialize SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err);
  } else {
    console.log("Connected to SQLite database.");

    // Create the 'users' table if it doesn't exist
    db.run(
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName TEXT NOT NULL,
        lastName TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        permitType TEXT NOT NULL,
        renewed BOOLEAN DEFAULT FALSE
      )`,
      (err) => {
        if (err) {
          console.error("Error creating table:", err);
        } else {
          console.log("Users table is ready.");
        }
      }
    );
  }
});

// Get the current directory from import.meta.url (workaround for ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // Static files served from 'public' directory
app.set("view engine", "ejs"); // Use EJS for templating

// Helmet - Setting HTTP headers for security
app.use(helmet());

// Content Security Policy (CSP)
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: [],
    },
  })
);

// Session middleware with secure cookies
app.use(
  session({
    secret: process.env.SESSION_SECRET, // Ensure this is set in your .env file
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true, // Prevent JavaScript access to cookies
      secure:
        process.env.NODE_ENV === "production" ||
        process.env.SECURE_COOKIE === "true", // Only send cookies over HTTPS
    },
  })
);

// Database function to check if user exists by email
async function checkUserExists(email) {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM users WHERE email = ?", [email], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Middleware to ensure user is logged in
function ensureAuthenticated(req, res, next) {
  if (!req.session.email) {
    return res.redirect("/login"); // If not logged in, redirect to login page
  }
  next();
}

// Utility function to sanitize user data
function sanitizeUserData(user) {
  return {
    email: sanitizeHtml(user.email),
    firstName: sanitizeHtml(user.firstName),
    lastName: sanitizeHtml(user.lastName),
  };
}

// Utility function to get count of renewed permits
async function getRenewedCount() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT COUNT(*) AS count FROM users WHERE renewed = TRUE",
      (err, row) => {
        if (err) reject(err);
        resolve(row.count); // Return the count
      }
    );
  });
}

// Routes

// Home page
app.get("/", (req, res) => {
  res.render("home"); // Assuming a 'home.ejs' view
});

// Login Routes
app.get("/login", (req, res) => {
  const message = req.query.message || ""; // Get the message from query or default to an empty string
  res.render("login", { message }); // Pass message to the view
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await checkUserExists(email);
    if (!user) {
      return res.redirect("/login?message=No user found.");
    }

    const match = await bcrypt.compare(password, user.password);
    if (match) {
      req.session.email = user.email;
      req.session.permitType = user.permitType;
      req.session.firstName = user.firstName;
      req.session.lastName = user.lastName;
      return res.redirect("/members");
    } else {
      return res.redirect(
        "/login?message=Incorrect email address or password."
      );
    }
  } catch (err) {
    console.error(err);
    return res.status(500).send("Error during login.");
  }
});

// Registration Route
app.get("/register", (req, res) => {
  res.render("register"); // Assuming 'register.ejs' view
});

app.post("/register", async (req, res) => {
  const { firstName, lastName, email, password, permitType } = req.body;

  try {
    // Check if user already exists
    const existingUser = await checkUserExists(email);
    if (existingUser) {
      return res.redirect("/register?message=User already exists.");
    }

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the new user into the database
    await new Promise((resolve, reject) => {
      db.run(
        "INSERT INTO users (firstName, lastName, email, password, permitType) VALUES (?, ?, ?, ?, ?)",
        [firstName, lastName, email, hashedPassword, permitType],
        function (err) {
          if (err) {
            console.error("Error inserting user into database", err);
            reject(err);
          }
          resolve();
        }
      );
    });

    // Redirect to login after successful registration
    res.redirect("/login");
  } catch (err) {
    console.error("Error during registration:", err);
    return res.status(500).send("Error registering user.");
  }
});

// Members Page Route
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

    // Set renewal price based on permitType
    let renewalPrice;
    let displayPaymentOption = false;
    switch (user.permitType) {
      case "Local Senior":
        renewalPrice = 2000; // £20.00 in cents
        displayPaymentOption = true;
        break;
      case "Local Adult":
        renewalPrice = 4000; // £40.00 in cents
        displayPaymentOption = true;
        break;
      case "Visiting Adult":
        renewalPrice = 10000; // £100.00 in cents
        displayPaymentOption = true;
        break;
      case "Visiting Senior":
        renewalPrice = 5000; // £50.00 in cents
        displayPaymentOption = true;
        break;
      default:
        renewalPrice = 0; // Default case if permitType is not recognized
        break;
    }

    // Store the renewal price in the session
    req.session.renewalPrice = renewalPrice;

    // Get the number of users who have already renewed their permits
    const renewedCount = await getRenewedCount();

    // Sanitize user data and render the view
    const sanitizedUser = sanitizeUserData(user);
    res.render("members", {
      ...sanitizedUser, // Pass sanitized user data
      permitType: sanitizedUser.permitType, // Pass permitType to the view
      renewalPrice: (renewalPrice / 100).toFixed(2), // Display price as pounds
      displayPaymentOption,
      renewedCount, // Pass the count to the view
    });
  } catch (err) {
    console.error("Error fetching user data:", err);
    return res.status(500).send("Error fetching user data.");
  }
});

// Checkout Route (Only one route)
app.get("/checkout", ensureAuthenticated, async (req, res) => {
  const { permitType, renewalPrice } = req.session;

  // Check if renewalPrice is available
  if (!renewalPrice) {
    console.error("Renewal price is missing or invalid.");
    return res.status(400).send("Error: Renewal price not available.");
  }

  // Query to get the number of users who have already renewed their permits
  const renewedCount = await getRenewedCount();

  // Sanitize the renewed count and permitType
  const sanitizedRenewedCount = sanitizeHtml(renewedCount.toString());
  const sanitizedPermitType = sanitizeHtml(permitType);

  // Sanitize user data
  const sanitizedUser = sanitizeUserData(req.session);

  // Render checkout page, passing sanitized data to the view
  res.render("checkout", {
    sanitizedRenewedCount, // Sanitized count of renewed permits
    sanitizedPermitType, // Sanitized permit type
    renewalPrice: (renewalPrice / 100).toFixed(2), // Directly pass the renewalPrice
    sanitizedUserEmail: sanitizeHtml(req.session.email), // Sanitized user email
    sanitizedUserFirstName: sanitizeHtml(req.session.firstName), // Sanitized user first name
    sanitizedUserLastName: sanitizeHtml(req.session.lastName), // Sanitized user last name
  });
});

// Stripe payment
app.post("/create-stripe-payment", async (req, res) => {
  try {
    const { amount, email, firstName, lastName } = req.body;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Renewal for ${firstName} ${lastName}`,
            },
            unit_amount: amount, // amount in cents
          },
          quantity: 1,
        },
      ],
      customer_email: email,
      mode: "payment",
      success_url: `${process.env.BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.BASE_URL}/cancel`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error("Error creating Stripe session:", error);
    res
      .status(500)
      .json({ error: "An error occurred while processing payment." });
  }
});


// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});