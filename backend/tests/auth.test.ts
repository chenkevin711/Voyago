import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectToDatabase, closeDatabaseConnection, getCollection } from '../src/config/database';
import argon2 from 'argon2';
import { User } from '../src/types';
import { ObjectId } from 'mongodb';

// Load environment variables from .env file
const { loadEnvFile } = require('node:process');
loadEnvFile();

describe('Authentication Tests', () => {
    beforeAll(async () => {
        await connectToDatabase();
        
        // Insert test user with username 'foo' and password 'bar'
        const usersCollection = getCollection<User>('users');
        const existingUser = await usersCollection.findOne({ username: 'foo' });

        if (!existingUser) {
            // Hash the password 'bar'
            const passwordHash = await argon2.hash('bar');
            
            // Insert test user
            await usersCollection.insertOne({
                email: 'foo@example.com',
                username: 'foo',
                password_hash: passwordHash,
                role: 'user',
                address: {
                    street: "3141 Chestnut Street",
                    city: "Philadelphia",
                    state: "PA",
                    country: "USA",
                    postal_code: "19104"
                }
            });
        }
    });

    afterAll(async () => {
        // Clean up: remove test user
        const usersCollection = getCollection<User>('users');
        await usersCollection.deleteOne({ username: 'foo' });
        
        // Close database connection
        await closeDatabaseConnection();
    });

    it('should connect to the database successfully', async () => {
        const db = await connectToDatabase();
        expect(db).toBeDefined();
        expect(db.databaseName).toBe('voyago_database');
    });

    it('should find user with username "foo" in the database', async () => {
        const usersCollection = getCollection<User>('users');
        const user = await usersCollection.findOne({ username: 'foo' });
        expect(user).toBeDefined();
        expect(user?.username).toBe('foo');
        expect(user?.email).toBe('foo@example.com');
    });

    it('should successfully authenticate user "foo" with password "bar"', async () => {
        const usersCollection = getCollection<User>('users');
        const user = await usersCollection.findOne({ username: 'foo' });
        expect(user).toBeDefined();
        const isPasswordValid = await argon2.verify(user!.password_hash, 'bar');
        expect(isPasswordValid).toBe(true);
    });

    it('should fail authentication with incorrect password', async () => {
        const usersCollection = getCollection<User>('users');
        const user = await usersCollection.findOne({ username: 'foo' });
        expect(user).toBeDefined();
        const isPasswordValid = await argon2.verify(user!.password_hash, 'wrongpassword');
        expect(isPasswordValid).toBe(false);
    });
});