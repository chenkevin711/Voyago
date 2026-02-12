import { MongoClient, Db, Collection, Document } from "mongodb";

let client: MongoClient;
let database: Db;

async function _connectToDatabase(): Promise<Db> {
    // Return existing connection if already established
    if (database) {
        return database;
    }

    // Retrieve MongoDB connection string from environment variables
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error("MONGODB_URI environment variable is not defined.");
    }

    try {
        // Create new MongoDB client instance
        client = new MongoClient(uri, {
            appName: "Voyago",
        });

        // Connect to MongoDB
        await client.connect();
        database = client.db("voyago_database");

        return database;
    } catch (error) {
        throw error;
    }
}

let connect$: Promise<Db>;

/**
 * Establishes connection to MongoDB by using the connection string from environment variables
 *
 * @returns Promise<Db> - The connected database instance
 * @throws Error if connection fails or if MONGODB_URI is not provided
 */
export async function connectToDatabase(): Promise<Db> {
  connect$ ??= _connectToDatabase();
  return await connect$;
}

/**
 * Closes the database connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (client) {
    await client.close();
  }
}

/**
 * Gets a reference to a specific collection in the database
 *
 * @param collectionName - Name of the collection to access
 * @returns Collection instance
 * @throws Error if database is not connected
 */
export function getCollection<T extends Document>(collectionName: string): Collection<T> {
  if (!database) {
    throw new Error("Database not connected.");
  }
  return database.collection(collectionName);
}