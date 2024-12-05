import Stripe from "stripe";

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Payment route to create Stripe payment session
app.post("/create-stripe-payment", async (req, res) => {
  const { amount, email, firstName, lastName } = req.body;

  // Ensure the amount is passed and is a valid integer (in the smallest unit, e.g., pence for GBP)
  const amountInCents = parseInt(amount, 10);
  if (isNaN(amountInCents) || amountInCents <= 0) {
    return res.status(400).send("Invalid amount.");
  }

  // Ensure necessary environment variables are set
  if (!process.env.STRIPE_SECRET_KEY || !process.env.BASE_URL) {
    console.error(
      "Missing environment variables: STRIPE_SECRET_KEY or BASE_URL."
    );
    return res
      .status(500)
      .send("Server misconfiguration. Please try again later.");
  }

  // Ensure email is valid using a regex for more comprehensive validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid or missing email address" });
  }

  try {
    // Create a new Checkout session with the amount passed from the frontend
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"], // Specify that we're accepting card payments
      line_items: [
        {
          price_data: {
            currency: "gbp", // Use GBP or another currency if needed
            product_data: {
              name: "Permit Renewal", // The product name, change it according to your case
              description: `${firstName} ${lastName} Permit Renewal`, // Include user details
            },
            unit_amount: amountInCents, // Amount in the smallest currency unit (e.g., pence for GBP)
          },
          quantity: 1, // We're only charging for one "Permit Renewal"
        },
      ],
      customer_email: email,
      mode: "payment", // We're processing a one-time payment
      success_url: `${process.env.BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`, // Redirect URL on success
      cancel_url: `${process.env.BASE_URL}/payment-cancelled`, // Redirect URL on cancellation
    });

    // Send the session ID back to the frontend
    res.json({ id: session.id });
  } catch (error) {
    console.error("Stripe payment creation error:", error);

    // More specific error handling based on the error type
    if (error.type === "StripeCardError") {
      return res
        .status(400)
        .send("There was an issue with the payment method.");
    }

    if (error.type === "StripeInvalidRequestError") {
      return res.status(400).send("Invalid request to Stripe API.");
    }

    if (error.type === "StripeAPIError") {
      return res.status(500).send("Stripe API error.");
    }

    res.status(500).send("Error creating payment session.");
  }
});
