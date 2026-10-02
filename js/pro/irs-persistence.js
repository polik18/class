(() => {
    'use strict';

    const DB_NAME = 'classroom_irs_v1';
    const DB_VERSION = 1;
    let databasePromise = null;

    const requestResult = request => new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), { once: true });
        request.addEventListener('error', () => reject(request.error), { once: true });
    });

    const transactionDone = transaction => new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), { once: true });
        transaction.addEventListener('abort', () => reject(transaction.error || new Error('indexeddb_transaction_aborted')), { once: true });
        transaction.addEventListener('error', () => reject(transaction.error || new Error('indexeddb_transaction_failed')), { once: true });
    });

    function openDatabase() {
        if (!('indexedDB' in window)) return Promise.reject(new Error('indexeddb_unavailable'));
        if (databasePromise) return databasePromise;

        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.addEventListener('upgradeneeded', () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('rooms')) {
                    db.createObjectStore('rooms', { keyPath: 'roomId' });
                }
                if (!db.objectStoreNames.contains('students')) {
                    const store = db.createObjectStore('students', { keyPath: ['roomId', 'clientId'] });
                    store.createIndex('roomId', 'roomId', { unique: false });
                }
                if (!db.objectStoreNames.contains('questions')) {
                    const store = db.createObjectStore('questions', { keyPath: ['roomId', 'questionId'] });
                    store.createIndex('roomId', 'roomId', { unique: false });
                }
                if (!db.objectStoreNames.contains('answers')) {
                    const store = db.createObjectStore('answers', { keyPath: ['roomId', 'questionId', 'clientId'] });
                    store.createIndex('roomId', 'roomId', { unique: false });
                    store.createIndex('questionId', ['roomId', 'questionId'], { unique: false });
                }
                if (!db.objectStoreNames.contains('messages')) {
                    const store = db.createObjectStore('messages', { keyPath: ['roomId', 'messageId'] });
                    store.createIndex('roomId', 'roomId', { unique: false });
                }
            });
            request.addEventListener('success', () => {
                request.result.addEventListener('versionchange', () => request.result.close());
                resolve(request.result);
            }, { once: true });
            request.addEventListener('error', () => {
                databasePromise = null;
                reject(request.error);
            }, { once: true });
            request.addEventListener('blocked', () => {
                databasePromise = null;
                reject(new Error('indexeddb_upgrade_blocked'));
            }, { once: true });
        });
        return databasePromise;
    }

    async function put(storeName, value) {
        const db = await openDatabase();
        const transaction = db.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(value);
        await transactionDone(transaction);
        return value;
    }

    async function getAllByRoom(transaction, storeName, roomId) {
        return requestResult(transaction.objectStore(storeName).index('roomId').getAll(IDBKeyRange.only(roomId)));
    }

    const persistence = {
        dbName: DB_NAME,

        async requestPersistentStorage() {
            if (!navigator.storage?.persist) return false;
            try {
                return await navigator.storage.persist();
            } catch {
                return false;
            }
        },

        saveRoom(room) {
            return put('rooms', { ...room, updatedAt: Date.now() });
        },

        saveStudent(student) {
            return put('students', { ...student, updatedAt: Date.now() });
        },

        saveQuestion(question) {
            return put('questions', { ...question, updatedAt: Date.now() });
        },

        async recordAnswer({ roomId, questionId, clientId, messageId, value, accepted = true, receivedAt = Date.now() }) {
            const db = await openDatabase();
            const transaction = db.transaction(['messages', 'answers'], 'readwrite');
            const messages = transaction.objectStore('messages');
            const answers = transaction.objectStore('answers');
            return new Promise((resolve, reject) => {
                let duplicate = false;
                let record = null;
                const request = messages.get([roomId, messageId]);
                request.addEventListener('success', () => {
                    if (request.result) {
                        duplicate = true;
                        record = request.result;
                        return;
                    }
                    record = { roomId, messageId, questionId, clientId, accepted, receivedAt };
                    messages.put(record);
                    if (accepted) {
                        answers.put({ roomId, questionId, clientId, messageId, value, receivedAt, updatedAt: Date.now() });
                    }
                }, { once: true });
                request.addEventListener('error', () => reject(request.error), { once: true });
                transaction.addEventListener('complete', () => resolve({ duplicate, record }), { once: true });
                transaction.addEventListener('abort', () => reject(transaction.error || new Error('indexeddb_transaction_aborted')), { once: true });
                transaction.addEventListener('error', () => reject(transaction.error || new Error('indexeddb_transaction_failed')), { once: true });
            });
        },

        async hasMessage(roomId, messageId) {
            const db = await openDatabase();
            const transaction = db.transaction('messages', 'readonly');
            const done = transactionDone(transaction);
            const result = await requestResult(transaction.objectStore('messages').get([roomId, messageId]));
            await done;
            return Boolean(result);
        },

        async getRoomSnapshot(roomId) {
            const db = await openDatabase();
            const transaction = db.transaction(['rooms', 'students', 'questions', 'answers'], 'readonly');
            const done = transactionDone(transaction);
            const [room, students, questions, answers] = await Promise.all([
                requestResult(transaction.objectStore('rooms').get(roomId)),
                getAllByRoom(transaction, 'students', roomId),
                getAllByRoom(transaction, 'questions', roomId),
                getAllByRoom(transaction, 'answers', roomId)
            ]);
            await done;
            return { room: room || null, students, questions, answers };
        },

        async deleteRoom(roomId) {
            const db = await openDatabase();
            const transaction = db.transaction(['rooms', 'students', 'questions', 'answers', 'messages'], 'readwrite');
            transaction.objectStore('rooms').delete(roomId);
            for (const storeName of ['students', 'questions', 'answers', 'messages']) {
                const store = transaction.objectStore(storeName);
                const keys = await requestResult(store.index('roomId').getAllKeys(IDBKeyRange.only(roomId)));
                keys.forEach(key => store.delete(key));
            }
            await transactionDone(transaction);
        }
    };

    window.IrsPersistence = Object.freeze(persistence);
})();
