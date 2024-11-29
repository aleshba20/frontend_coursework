const express = require("express");
const MongoClient = require("mongodb").MongoClient;
const ObjectID = require("mongodb").ObjectID;
const path = require("path");

const app = express();
app.use(express.json());
app.set("port", 3000);

// Set CORS headers
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers"
  );
  next();
});

// Basic Logger
function logger(message, type = "info") {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${type.toUpperCase()}]: ${message}`;
  console.log(logMessage);
}

// MongoDB connection with retry logic
let db;
const connectWithRetry = () => {
  MongoClient.connect(
    "mongodb+srv://aleshbariaz:Riaz@2002@gettingstarted.u6tba.mongodb.net/",
    { useUnifiedTopology: true },
    (err, client) => {
      if (err) {
        logger("Failed to connect to MongoDB. Retrying...", "error");
        setTimeout(connectWithRetry, 5000); // Retry after 5 seconds
      } else {
        db = client.db("school_activities");
        logger("Connected to MongoDB", "success");
      }
    }
  );
};
connectWithRetry();

// Serve Static Images
const imagesPath = path.join(__dirname, "images");
app.use("/images", express.static(imagesPath));

// Example Endpoint to Test Static Files
app.get("/test-image", (req, res) => {
  res.send({
    imageUrl: `${req.protocol}://${req.get("host")}/images/example.jpg`, // Replace "example.jpg" with your image filename
  });
});

// Middleware to log search activities dynamically using RegExp
app.use((req, res, next) => {
  const searchRegex = /log-search/; // Matches the /log-search endpoint
  if (searchRegex.test(req.url) && req.method === "GET") {
    const searchQuery = req.query.query?.trim(); // Extract search query
    if (searchQuery) {
      logger(`User searched for: ${searchQuery}`, "info"); // Log the search term
    } else {
      logger("Search query is missing or empty", "warn");
    }
  }
  next(); // Proceed to the next middleware or route handler
});

// Serve static files with logging
const staticPath = path.resolve(__dirname, "public");
app.use(
  "/static",
  (req, res, next) => {
    logger(`Serving static file: ${req.url}`, "info");
    next();
  },
  express.static(staticPath)
);

// Default message
app.get("/", (req, res) => {
  logger("Default route accessed");
  res.send("Select a collection, e.g., /collection/messages");
});

// Get the collection name
app.param("collectionName", (req, res, next, collectionName) => {
  logger(`Accessing collection: ${collectionName}`);
  req.collection = db.collection(collectionName);
  return next();
});

// Fetch all documents in a collection
app.get("/collection/:collectionName", (req, res, next) => {
  req.collection.find({}).toArray((e, results) => {
    if (e) {
      logger(`Error fetching documents: ${e.message}`, "error");
      return next(e);
    }
    logger(
      `Fetched ${results.length} documents from collection: ${req.params.collectionName}`
    );
    res.send(results);
  });
});

// Insert a new document into a collection
app.post("/collection/:collectionName", (req, res, next) => {
  req.collection.insertOne(req.body, (e, result) => {
    if (e) {
      logger(`Error inserting document: ${e.message}`, "error");
      return next(e);
    }
    logger(
      `Inserted document into collection: ${
        req.params.collectionName
      }, Data: ${JSON.stringify(req.body)}`
    );
    res.send(result.ops);
  });
});

// Fetch a single document by ID
app.get("/collection/:collectionName/:id", (req, res, next) => {
  req.collection.findOne({ _id: new ObjectID(req.params.id) }, (e, result) => {
    if (e) {
      logger(`Error fetching document by ID: ${e.message}`, "error");
      return next(e);
    }
    if (result) {
      logger(`Fetched document by ID: ${req.params.id}`);
      res.send(result);
    } else {
      logger(`Document with ID ${req.params.id} not found`, "warn");
      res.status(404).send({ msg: "Document not found" });
    }
  });
});

// Log search activities and fetch matching results from 'lessons' collection
app.get("/log-search", async (req, res) => {
  const searchQuery = req.query.query?.trim(); // Extract query parameter
  if (!searchQuery) {
    logger("Search query is missing in the request parameters", "warn");
    return res.status(400).send({ msg: "Search query is required" });
  }

  logger(`Search activity recorded: ${searchQuery}`, "info");

  try {
    // Search for matching lessons in the database
    const results = await db
      .collection("lessons")
      .find({
        $or: [
          { title: { $regex: searchQuery, $options: "i" } }, // Case-insensitive search on 'title'
          { description: { $regex: searchQuery, $options: "i" } }, // Case-insensitive search on 'description'
        ],
      })
      .toArray();

    // Log results in the terminal
    logger(`Search results for '${searchQuery}': ${JSON.stringify(results)}`);

    // Send the results back to the frontend
    res.send(results);
  } catch (error) {
    logger(`Error fetching search results: ${error.message}`, "error");
    res.status(500).send({ msg: "Error fetching search results" });
  }
});

// Place an order and update lesson inventory
app.post("/place-order", async (req, res) => {
  const orderData = req.body;

  // Validate required fields
  if (
    !orderData.firstName ||
    !orderData.lastName ||
    !orderData.address ||
    !orderData.city ||
    !orderData.state ||
    !orderData.zip ||
    !orderData.phone ||
    !orderData.method ||
    !orderData.cart ||
    orderData.cart.length === 0
  ) {
    return res.status(400).send({ msg: "Incomplete order data" });
  }

  try {
    // Insert the order into the "orders" collection
    const orderResult = await db.collection("orders").insertOne(orderData);
    console.log("Order successfully placed:", orderResult.insertedId);

    // Update the availableInventory in the "lessons" collection
    const bulkOperations = orderData.cart.map((item) => ({
      updateOne: {
        filter: { id: item.id },
        update: { $inc: { availableInventory: -1 } }, // Decrease inventory
      },
    }));

    const inventoryUpdateResult = await db
      .collection("lessons")
      .bulkWrite(bulkOperations);
    console.log("Inventory updated:", inventoryUpdateResult);

    res.status(200).send({ msg: "Order placed successfully!" });
  } catch (error) {
    console.error("Error placing order:", error);
    res.status(500).send({ msg: "Error placing order", error: error.message });
  }
});

// Unified error handler
app.use((err, req, res, next) => {
  logger(`Unhandled error: ${err.message}`, "error");
  res.status(500).send({ msg: "An error occurred", error: err.message });
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  logger(`Server running at http://localhost:${port}`, "success");
});
