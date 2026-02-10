import * as vscode from 'vscode';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signInWithCredential, OAuthCredential } from 'firebase/auth';
import { getFirestore, Firestore, collection, doc, setDoc, getDoc, getDocs, query, where, orderBy, limit, Timestamp } from 'firebase/firestore';
import { ChatMessage } from '../types';

interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
}

interface ChatHistory {
    id: string;
    messages: ChatMessage[];
    timestamp: number;
    userId: string;
}

interface OrgPlaybook {
    id: string;
    name: string;
    prompt: string;
    orgId: string;
    createdBy: string;
    createdAt: number;
    active: boolean;
}

export class FirebaseService {
    private app: FirebaseApp | null = null;
    private auth: Auth | null = null;
    private db: Firestore | null = null;
    private currentUser: User | null = null;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initialize();
    }

    /**
     * Initialize Firebase with user's config
     */
    private async initialize() {
        const config = vscode.workspace.getConfiguration('xendcode');
        const firebaseConfig: FirebaseConfig = {
            apiKey: config.get('firebase.apiKey', ''),
            authDomain: config.get('firebase.authDomain', ''),
            projectId: config.get('firebase.projectId', ''),
            storageBucket: config.get('firebase.storageBucket', ''),
            messagingSenderId: config.get('firebase.messagingSenderId', ''),
            appId: config.get('firebase.appId', '')
        };

        // Only initialize if config is provided
        if (firebaseConfig.apiKey && firebaseConfig.projectId) {
            try {
                this.app = initializeApp(firebaseConfig);
                this.auth = getAuth(this.app);
                this.db = getFirestore(this.app);

                // Listen for auth state changes
                onAuthStateChanged(this.auth, (user) => {
                    this.currentUser = user;
                    if (user) {
                        vscode.window.showInformationMessage(`Logged in as ${user.email}`);
                        this.syncChatHistory();
                    }
                });

                console.log('Firebase initialized successfully');
            } catch (error: any) {
                console.error('Firebase initialization error:', error);
                vscode.window.showErrorMessage(`Firebase init failed: ${error.message}`);
            }
        }
    }

    /**
     * Check if Firebase is configured
     */
    isConfigured(): boolean {
        return this.app !== null && this.auth !== null && this.db !== null;
    }

    /**
     * Check if user is logged in
     */
    isLoggedIn(): boolean {
        return this.currentUser !== null;
    }

    /**
     * Get current user
     */
    getCurrentUser(): User | null {
        return this.currentUser;
    }

    /**
     * Sign in with Google OAuth
     */
    async signInWithGoogle(): Promise<void> {
        if (!this.auth) {
            throw new Error('Firebase not configured');
        }

        try {
            const provider = new GoogleAuthProvider();
            provider.addScope('email');
            provider.addScope('profile');
            
            // Use popup for OAuth flow
            const result = await signInWithPopup(this.auth, provider);
            this.currentUser = result.user;
            
            // Get the Google credential
            const credential = GoogleAuthProvider.credentialFromResult(result);
            if (credential) {
                console.log('Google OAuth successful:', result.user.email);
            }
        } catch (error: any) {
            throw new Error(`Google sign-in failed: ${error.message}`);
        }
    }

    /**
     * Sign in with email and password
     */
    async signIn(email: string, password: string): Promise<void> {
        if (!this.auth) {
            throw new Error('Firebase not configured. Please add Firebase credentials in settings.');
        }

        try {
            const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
            this.currentUser = userCredential.user;
            vscode.window.showInformationMessage(`Welcome back, ${email}!`);
        } catch (error: any) {
            throw new Error(`Login failed: ${error.message}`);
        }
    }

    /**
     * Sign up with email and password
     */
    async signUp(email: string, password: string): Promise<void> {
        if (!this.auth) {
            throw new Error('Firebase not configured');
        }

        try {
            const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
            this.currentUser = userCredential.user;
            vscode.window.showInformationMessage(`Account created! Welcome, ${email}!`);
        } catch (error: any) {
            throw new Error(`Sign up failed: ${error.message}`);
        }
    }

    /**
     * Sign out
     */
    async signOutUser(): Promise<void> {
        if (!this.auth) {
            return;
        }

        try {
            await signOut(this.auth);
            this.currentUser = null;
            vscode.window.showInformationMessage('Signed out successfully');
        } catch (error: any) {
            throw new Error(`Sign out failed: ${error.message}`);
        }
    }

    /**
     * Save chat history to Firestore
     */
    async saveChatHistory(messages: ChatMessage[]): Promise<void> {
        if (!this.db || !this.currentUser) {
            return; // Silently skip if not configured or logged in
        }

        try {
            const chatHistoryRef = doc(collection(this.db, 'chatHistory'));
            const historyData: ChatHistory = {
                id: chatHistoryRef.id,
                messages,
                timestamp: Date.now(),
                userId: this.currentUser.uid
            };

            await setDoc(chatHistoryRef, historyData);
        } catch (error: any) {
            console.error('Failed to save chat history:', error);
        }
    }

    /**
     * Load chat history from Firestore
     */
    async loadChatHistory(limitCount: number = 10): Promise<ChatHistory[]> {
        if (!this.db || !this.currentUser) {
            return [];
        }

        try {
            const historyRef = collection(this.db, 'chatHistory');
            const q = query(
                historyRef,
                where('userId', '==', this.currentUser.uid),
                orderBy('timestamp', 'desc'),
                limit(limitCount)
            );

            const snapshot = await getDocs(q);
            const histories: ChatHistory[] = [];

            snapshot.forEach((doc) => {
                histories.push(doc.data() as ChatHistory);
            });

            return histories;
        } catch (error: any) {
            console.error('Failed to load chat history:', error);
            return [];
        }
    }

    /**
     * Sync chat history on login
     */
    private async syncChatHistory() {
        try {
            const histories = await this.loadChatHistory(5);
            console.log(`Synced ${histories.length} chat histories`);
        } catch (error) {
            console.error('Chat history sync failed:', error);
        }
    }

    /**
     * Save org playbook
     */
    async savePlaybook(name: string, prompt: string, orgId: string): Promise<void> {
        if (!this.db || !this.currentUser) {
            throw new Error('Must be logged in to save playbooks');
        }

        try {
            const playbookRef = doc(collection(this.db, 'playbooks'));
            const playbookData: OrgPlaybook = {
                id: playbookRef.id,
                name,
                prompt,
                orgId,
                createdBy: this.currentUser.uid,
                createdAt: Date.now(),
                active: true
            };

            await setDoc(playbookRef, playbookData);
            vscode.window.showInformationMessage(`Playbook "${name}" saved!`);
        } catch (error: any) {
            throw new Error(`Failed to save playbook: ${error.message}`);
        }
    }

    /**
     * Load org playbooks
     */
    async loadPlaybooks(orgId: string): Promise<OrgPlaybook[]> {
        if (!this.db) {
            return [];
        }

        try {
            const playbooksRef = collection(this.db, 'playbooks');
            const q = query(
                playbooksRef,
                where('orgId', '==', orgId),
                where('active', '==', true),
                orderBy('createdAt', 'desc')
            );

            const snapshot = await getDocs(q);
            const playbooks: OrgPlaybook[] = [];

            snapshot.forEach((doc) => {
                playbooks.push(doc.data() as OrgPlaybook);
            });

            return playbooks;
        } catch (error: any) {
            console.error('Failed to load playbooks:', error);
            return [];
        }
    }

    /**
     * Get active playbook prompt for org
     */
    async getActivePlaybookPrompt(orgId: string): Promise<string | null> {
        const playbooks = await this.loadPlaybooks(orgId);
        
        // Return the most recent active playbook
        if (playbooks.length > 0) {
            return playbooks[0].prompt;
        }
        
        return null;
    }

    /**
     * Save user context to Firestore
     */
    async saveUserContext(contextData: any): Promise<void> {
        if (!this.db || !this.currentUser) {
            return;
        }

        try {
            const userContextRef = doc(this.db, 'userContexts', this.currentUser.uid);
            await setDoc(userContextRef, {
                ...contextData,
                updatedAt: Date.now()
            }, { merge: true });
        } catch (error: any) {
            console.error('Failed to save user context:', error);
        }
    }

    /**
     * Load user context from Firestore
     */
    async loadUserContext(): Promise<any> {
        if (!this.db || !this.currentUser) {
            return null;
        }

        try {
            const userContextRef = doc(this.db, 'userContexts', this.currentUser.uid);
            const docSnap = await getDoc(userContextRef);

            if (docSnap.exists()) {
                return docSnap.data();
            }
            
            return null;
        } catch (error: any) {
            console.error('Failed to load user context:', error);
            return null;
        }
    }
}
