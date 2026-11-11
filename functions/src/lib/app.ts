import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

export const db = getFirestore();
export const adminAuth = getAuth();
export const now = () => FieldValue.serverTimestamp();
export const stamp = () => Timestamp.now();
export { FieldValue };
