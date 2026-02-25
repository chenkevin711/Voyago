import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectToDatabase, closeDatabaseConnection, getCollection } from '../src/config/database';
import { User, Relation } from '../src/types';
import { ObjectId } from 'mongodb';

const { loadEnvFile } = require('node:process');
loadEnvFile();

const userAliceId = new ObjectId();
const userBobId   = new ObjectId();
const userEveId   = new ObjectId();

const userAlice: User = {
    _id: userAliceId,
    username: 'test_alice',
    email: 'test_alice@example.com',
    password_hash: 'hash_alice',
    role: 'user',
};

const userBob: User = {
    _id: userBobId,
    username: 'test_bob',
    email: 'test_bob@example.com',
    password_hash: 'hash_bob',
    role: 'user',
};

const userEve: User = {
    _id: userEveId,
    username: 'test_eve',
    email: 'test_eve@example.com',
    password_hash: 'hash_eve',
    role: 'user',
};

describe('Relations Tests', () => {
    beforeAll(async () => {
        await connectToDatabase();

        const usersCollection     = getCollection<User>('users');
        const relationsCollection = getCollection<Relation>('relations');

        // Insert test users if they don't already exist
        for (const user of [userAlice, userBob, userEve]) {
            const existing = await usersCollection.findOne({ username: user.username });
            if (!existing) {
                await usersCollection.insertOne(user);
            }
        }

        // Clean any leftover relations from a previous interrupted run
        await relationsCollection.deleteMany({
            $or: [
                { user1_id: userAliceId },
                { user2_id: userAliceId },
                { user1_id: userBobId },
                { user2_id: userBobId },
                { user1_id: userEveId },
                { user2_id: userEveId },
            ],
        });
    });

    afterAll(async () => {
        const usersCollection     = getCollection<User>('users');
        const relationsCollection = getCollection<Relation>('relations');

        await usersCollection.deleteMany({
            username: { $in: ['test_alice', 'test_bob', 'test_eve'] },
        });

        await relationsCollection.deleteMany({
            $or: [
                { user1_id: userAliceId },
                { user2_id: userAliceId },
                { user1_id: userBobId },
                { user2_id: userBobId },
                { user1_id: userEveId },
                { user2_id: userEveId },
            ],
        });

        await closeDatabaseConnection();
    });

    it('should connect to the database successfully', async () => {
        const db = await connectToDatabase();
        expect(db).toBeDefined();
        expect(db.databaseName).toBe('voyago_database');
    });

    it('should find all three test users in the database', async () => {
        const usersCollection = getCollection<User>('users');

        const alice = await usersCollection.findOne({ username: 'test_alice' });
        const bob   = await usersCollection.findOne({ username: 'test_bob' });
        const eve   = await usersCollection.findOne({ username: 'test_eve' });

        expect(alice).toBeDefined();
        expect(bob).toBeDefined();
        expect(eve).toBeDefined();

        expect(alice?.email).toBe('test_alice@example.com');
        expect(bob?.email).toBe('test_bob@example.com');
        expect(eve?.email).toBe('test_eve@example.com');
    });

    it('should insert a pending relation when alice sends bob a friend request', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        await relationsCollection.insertOne({
            user1_id: userAliceId,
            user2_id: userBobId,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
        });

        const relation = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userBobId,
        });

        expect(relation).toBeDefined();
        expect(relation?.status).toBe('pending');
    });

    it('should detect a duplicate pending request between the same two users', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const existing = await relationsCollection.findOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
        });

        expect(existing).toBeDefined();
        expect(existing?.status).toBe('pending');
    });


    it('should update the relation status to accepted when bob accepts alice\'s request', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const relation = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userBobId,
            status: 'pending',
        });

        expect(relation).toBeDefined();

        await relationsCollection.updateOne(
            { _id: relation!._id },
            { $set: { status: 'accepted', updated_at: new Date() } }
        );

        const updated = await relationsCollection.findOne({ _id: relation!._id });
        expect(updated?.status).toBe('accepted');
    });

    it('should find the accepted friendship regardless of which user is user1_id', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const friendship = await relationsCollection.findOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
            status: 'accepted',
        });

        expect(friendship).toBeDefined();
    });


    it('should delete the pending relation when alice declines eve\'s friend request', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        await relationsCollection.insertOne({
            user1_id: userEveId,
            user2_id: userAliceId,
            status: 'pending',
            created_at: new Date(),
            updated_at: new Date(),
        });

        const before = await relationsCollection.findOne({
            user1_id: userEveId,
            user2_id: userAliceId,
            status: 'pending',
        });
        expect(before).toBeDefined();

        const result = await relationsCollection.deleteOne({
            user1_id: userEveId,
            user2_id: userAliceId,
            status: 'pending',
        });

        expect(result.deletedCount).toBe(1);

        const after = await relationsCollection.findOne({
            user1_id: userEveId,
            user2_id: userAliceId,
        });
        expect(after).toBeNull();
    });

    it('should delete the accepted relation when alice unfriends bob', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const before = await relationsCollection.findOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
            status: 'accepted',
        });
        expect(before).toBeDefined();

        const result = await relationsCollection.deleteOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
            status: 'accepted',
        });

        expect(result.deletedCount).toBe(1);

        const after = await relationsCollection.findOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
        });
        expect(after).toBeNull();
    });


    it('should insert a blocked relation when alice blocks eve', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        await relationsCollection.deleteOne({
            $or: [
                { user1_id: userAliceId, user2_id: userEveId },
                { user1_id: userEveId,   user2_id: userAliceId },
            ],
        });

        await relationsCollection.insertOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
            created_at: new Date(),
            updated_at: new Date(),
        });

        const blocked = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
        });

        expect(blocked).toBeDefined();
        expect(blocked?.status).toBe('blocked');
    });

    it('should store the blocker as user1_id and the blocked user as user2_id', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const relation = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
        });

        expect(relation).toBeDefined();
        expect(relation!.user1_id.equals(userAliceId)).toBe(true);
        expect(relation!.user2_id.equals(userEveId)).toBe(true);
    });

    it('should overwrite an existing friendship when a block is applied', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        // Re-create alice <-> bob as accepted
        await relationsCollection.insertOne({
            user1_id: userAliceId,
            user2_id: userBobId,
            status: 'accepted',
            created_at: new Date(),
            updated_at: new Date(),
        });

        // Alice blocks bob — delete existing, then insert blocked
        await relationsCollection.deleteOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
        });
        await relationsCollection.insertOne({
            user1_id: userAliceId,
            user2_id: userBobId,
            status: 'blocked',
            created_at: new Date(),
            updated_at: new Date(),
        });

        const relation = await relationsCollection.findOne({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
        });

        expect(relation).toBeDefined();
        expect(relation?.status).toBe('blocked');
        await relationsCollection.deleteOne({ user1_id: userAliceId, user2_id: userBobId });
    });

    it('should delete the blocked relation when alice unblocks eve', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        const before = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
        });
        expect(before).toBeDefined();

        const result = await relationsCollection.deleteOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
        });

        expect(result.deletedCount).toBe(1);

        const after = await relationsCollection.findOne({
            user1_id: userAliceId,
            user2_id: userEveId,
        });
        expect(after).toBeNull();
    });

    it('should not delete a block when the caller is user2_id rather than the blocker', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        // Eve blocks alice
        await relationsCollection.insertOne({
            user1_id: userEveId,
            user2_id: userAliceId,
            status: 'blocked',
            created_at: new Date(),
            updated_at: new Date(),
        });

        // Alice queries as user1_id — should match nothing since eve is the blocker
        const result = await relationsCollection.deleteOne({
            user1_id: userAliceId,
            user2_id: userEveId,
            status: 'blocked',
        });

        expect(result.deletedCount).toBe(0);

        // Clean up
        await relationsCollection.deleteOne({ user1_id: userEveId, user2_id: userAliceId });
    });

    it('should return only accepted relations when listing friends', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        // alice <-> bob accepted, alice -> eve pending
        await relationsCollection.insertMany([
            {
                user1_id: userAliceId,
                user2_id: userBobId,
                status: 'accepted',
                created_at: new Date(),
                updated_at: new Date(),
            },
            {
                user1_id: userAliceId,
                user2_id: userEveId,
                status: 'pending',
                created_at: new Date(),
                updated_at: new Date(),
            },
        ]);

        const acceptedRelations = await relationsCollection.find({
            $or: [
                { user1_id: userAliceId },
                { user2_id: userAliceId },
            ],
            status: 'accepted',
        }).toArray();

        expect(acceptedRelations).toHaveLength(1);
        expect(
            acceptedRelations[0].user2_id.equals(userBobId) ||
            acceptedRelations[0].user1_id.equals(userBobId)
        ).toBe(true);

        // Clean up
        await relationsCollection.deleteMany({
            $or: [
                { user1_id: userAliceId, user2_id: userBobId },
                { user1_id: userAliceId, user2_id: userEveId },
            ],
        });
    });

    it('should return only incoming pending requests for the current user', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        // Bob sends alice a request; alice sends eve a request
        await relationsCollection.insertMany([
            {
                user1_id: userBobId,
                user2_id: userAliceId,
                status: 'pending',
                created_at: new Date(),
                updated_at: new Date(),
            },
            {
                user1_id: userAliceId,
                user2_id: userEveId,
                status: 'pending',
                created_at: new Date(),
                updated_at: new Date(),
            },
        ]);

        // Only requests where alice is user2_id (incoming)
        const incoming = await relationsCollection.find({
            user2_id: userAliceId,
            status: 'pending',
        }).toArray();

        expect(incoming).toHaveLength(1);
        expect(incoming[0].user1_id.equals(userBobId)).toBe(true);

        // Clean up
        await relationsCollection.deleteMany({
            $or: [
                { user1_id: userBobId,   user2_id: userAliceId },
                { user1_id: userAliceId, user2_id: userEveId },
            ],
        });
    });

    it('should return only users blocked by the current user, not users who blocked them', async () => {
        const relationsCollection = getCollection<Relation>('relations');

        // Alice blocks eve; bob blocks alice
        await relationsCollection.insertMany([
            {
                user1_id: userAliceId,
                user2_id: userEveId,
                status: 'blocked',
                created_at: new Date(),
                updated_at: new Date(),
            },
            {
                user1_id: userBobId,
                user2_id: userAliceId,
                status: 'blocked',
                created_at: new Date(),
                updated_at: new Date(),
            },
        ]);

        // Only blocks where alice is the blocker
        const blockedByAlice = await relationsCollection.find({
            user1_id: userAliceId,
            status: 'blocked',
        }).toArray();

        expect(blockedByAlice).toHaveLength(1);
        expect(blockedByAlice[0].user2_id.equals(userEveId)).toBe(true);

        // Clean up
        await relationsCollection.deleteMany({
            $or: [
                { user1_id: userAliceId, user2_id: userEveId },
                { user1_id: userBobId,   user2_id: userAliceId },
            ],
        });
    });
});