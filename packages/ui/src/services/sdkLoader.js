// SDK Loader - Handles dynamic loading of CipherPay SDK
let CipherPaySDK = null;
let ChainType = null;
let sdkInitialized = false;
let sdkInitPromise = null;

export async function loadSDK() {
    if (sdkInitPromise) return sdkInitPromise;

    sdkInitPromise = (async () => {
        // Use real SDK when: VITE_USE_REAL_SDK=true, or production build (unless explicitly false)
        const useRealSDK = import.meta.env.VITE_USE_REAL_SDK === 'true' ||
            (import.meta.env.PROD && import.meta.env.VITE_USE_REAL_SDK !== 'false');
        console.log('🔍 SDK Loader: Checking environment...');
        console.log('VITE_USE_REAL_SDK:', import.meta.env.VITE_USE_REAL_SDK, 'PROD:', import.meta.env.PROD, 'useRealSDK:', useRealSDK);

        if (!useRealSDK) {
            console.log('❌ Real SDK disabled, using mock components');
            sdkInitialized = false;
            ChainType = { ethereum: 'ethereum', solana: 'solana' };
            return { CipherPaySDK: null, ChainType, sdkInitialized };
        }

        console.log('🚀 Attempting to load CipherPay SDK...');
        console.log('🔍 Checking global scope for SDK...');

        // Log available global objects for debugging
        const globalObjects = Object.keys(window).filter(key =>
            key.toLowerCase().includes('cipher') ||
            key.toLowerCase().includes('sdk') ||
            key.toLowerCase().includes('pay')
        );
        console.log('Available global objects:', globalObjects);

        // Try to load SDK from global scope
        let attempts = 0;
        const maxAttempts = 10;

        while (attempts < maxAttempts) {
            attempts++;

            // Check if SDK is available in global scope
            if (typeof window.CipherPaySDK !== 'undefined') {
                console.log('✅ CipherPay SDK found in global scope!');
                const sdkGlobal = window.CipherPaySDK;
                
                // Check what type of object it is
                console.log('🔍 SDK type:', typeof sdkGlobal);
                console.log('🔍 SDK is constructor?', typeof sdkGlobal === 'function' && sdkGlobal.prototype && sdkGlobal.prototype.constructor === sdkGlobal);
                console.log('🔍 SDK keys:', Object.keys(sdkGlobal || {}));
                
                // Check if it's a constructor (class/function that can be instantiated)
                const isConstructor = typeof sdkGlobal === 'function' && 
                                     (sdkGlobal.prototype && sdkGlobal.prototype.constructor === sdkGlobal);
                
                if (isConstructor) {
                    CipherPaySDK = sdkGlobal;
                    ChainType = { ethereum: 'ethereum', solana: 'solana' };
                    sdkInitialized = true;

                    // Test creating an instance
                    try {
                        const testInstance = new CipherPaySDK({
                            chainType: 'solana',
                            rpcUrl: 'http://localhost:8899'
                        });
                        console.log('✅ SDK instance created successfully');
                        return { CipherPaySDK, ChainType, sdkInitialized };
                    } catch (error) {
                        console.error('❌ Failed to create SDK instance:', error);
                        sdkInitialized = false;
                        return { CipherPaySDK: null, ChainType, sdkInitialized };
                    }
                } else {
                    // SDK exists but is not a constructor - it's likely just utility functions
                    console.log('⚠️ CipherPaySDK found but is not a constructor (likely utility functions only)');
                    console.log('📦 SDK exports:', Object.keys(sdkGlobal || {}));
                    console.log('🔄 SDK structure does not match expected CipherPaySDK class, falling back to mock components');
                    sdkInitialized = false;
                    ChainType = { ethereum: 'ethereum', solana: 'solana' };
                    return { CipherPaySDK: null, ChainType, sdkInitialized };
                }
            }

            console.log(`⏳ SDK not found yet, attempt ${attempts}/${maxAttempts}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log('❌ CipherPay SDK not found in global scope after all attempts');
        console.log('🔄 Falling back to mock components');
        sdkInitialized = false;
        ChainType = { ethereum: 'ethereum', solana: 'solana' };
        return { CipherPaySDK: null, ChainType, sdkInitialized };
    })();

    return sdkInitPromise;
}

export function getSDKStatus() {
    return {
        sdkInitialized,
        hasSDK: CipherPaySDK !== null,
        hasChainType: ChainType !== null
    };
} 