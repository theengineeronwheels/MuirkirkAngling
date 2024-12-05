// Assuming the variables are dynamically injected into the page
let renewalPrice = 100; // Replace with dynamic renewal price from the server
let email = "<%= sanitizedUserEmail || '' %>"; // Dynamically set from the server
let firstName = "<%= sanitizedUserFirstName || '' %>"; // Dynamically set from the server
let lastName = "<%= sanitizedUserLastName || '' %>"; // Dynamically set from the server

document.addEventListener("DOMContentLoaded", function () {
  const payButton = document.getElementById("payButton");

  // Check if the pay button exists
  if (!payButton) {
    alert("Pay button not found. Please contact support.");
    return;
  }

  // Ensure the renewal price is valid
  if (isNaN(renewalPrice) || renewalPrice <= 0) {
    alert("Invalid renewal price.");
    return;
  }

  // Ensure the user data is valid
  if (!email || !firstName || !lastName) {
    alert("Missing user details. Please check the user information.");
    return;
  }

  payButton.addEventListener("click", function () {
    // Create the payment data object
    const user = {
      email: email,
      firstName: firstName,
      lastName: lastName,
    };

    const paymentData = {
      amount: renewalPrice, // Use the closure-scoped renewalPrice value
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    // Make a request to create a Stripe payment session
    fetch("/create-stripe-payment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paymentData),
    })
      .then(function (response) {
        // Check if the response is not OK
        if (!response.ok) {
          return response.json().then((errorData) => {
            console.error("Server error:", errorData);
            throw new Error(errorData.error || "Unknown error occurred");
          });
        }
        // Return the response JSON if everything is okay
        return response.json();
      })
      .then(function (data) {
        // Assuming the server returns a session ID for Stripe
        const sessionId = data.id;
        if (sessionId) {
          // Redirect to Stripe checkout page
          window.location.href = `https://checkout.stripe.com/pay/${sessionId}`;
        } else {
          throw new Error("Session ID not received from server.");
        }
      })
      .catch(function (error) {
        // Handle any errors that occur during the fetch or the session creation
        console.error("Error:", error.message); // Log the error message
        alert("Payment failed: " + error.message); // Show an alert with the error message
      });
  });
});
