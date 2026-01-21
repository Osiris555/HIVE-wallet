\# HIVE Wallet – Phase 0 Codebase Scaffold



This is the initial production-ready scaffold for the HIVE Wallet Phase 0 implementation.



---



\## Repository Structure



```

hive-wallet/

├─ apps/

│  └─ mobile/

│     ├─ App.tsx

│     ├─ app.json

│     ├─ package.json

│     └─ src/

│        ├─ screens/

│        │  ├─ WelcomeScreen.tsx

│        │  ├─ CreateWalletScreen.tsx

│        │  ├─ ImportWalletScreen.tsx

│        │  ├─ HomeScreen.tsx

│        │  └─ LockScreen.tsx

│        ├─ navigation/

│        │  └─ RootNavigator.tsx

│        ├─ crypto/

│        │  ├─ mnemonic.ts

│        │  ├─ keyDerivation.ts

│        │  ├─ signer.ts

│        │  └─ storage.ts

│        ├─ chain/

│        │  ├─ address.ts

│        │  ├─ txBuilder.ts

│        │  └─ staking.ts

│        ├─ services/

│        │  └─ indexer.ts

│        ├─ state/

│        │  └─ walletStore.ts

│        └─ utils/

│           └─ secure.ts

├─ packages/

│  └─ crypto-core/

│     ├─ src/

│     │  ├─ bip39.ts

│     │  ├─ hd.ts

│     │  └─ types.ts

│     └─ package.json

└─ README.md

```



---



\## Technology Choices (Locked)



\- React Native (Expo)

\- TypeScript

\- Zustand (state)

\- react-navigation

\- expo-secure-store / platform keystore

\- No backend dependency required



---



\## App.tsx (Entry Point)



```ts

import React from 'react';

import { NavigationContainer } from '@react-navigation/native';

import { RootNavigator } from './src/navigation/RootNavigator';



export default function App() {

&nbsp; return (

&nbsp;   <NavigationContainer>

&nbsp;     <RootNavigator />

&nbsp;   </NavigationContainer>

&nbsp; );

}

```



---



\## crypto/mnemonic.ts



```ts

import \* as bip39 from 'bip39';



export function generateMnemonic(words: 12 | 24 = 24): string {

&nbsp; return bip39.generateMnemonic(words === 12 ? 128 : 256);

}



export function validateMnemonic(mnemonic: string): boolean {

&nbsp; return bip39.validateMnemonic(mnemonic);

}

```



---



\## crypto/keyDerivation.ts



```ts

import { mnemonicToSeedSync } from 'bip39';

import { HDKey } from '@scure/bip32';



const HONEY\_PATH = "m/44'/7777'/0'/0/0";



export function deriveHoneyKey(mnemonic: string) {

&nbsp; const seed = mnemonicToSeedSync(mnemonic);

&nbsp; const hd = HDKey.fromMasterSeed(seed);

&nbsp; const child = hd.derive(HONEY\_PATH);



&nbsp; if (!child.privateKey) {

&nbsp;   throw new Error('Key derivation failed');

&nbsp; }



&nbsp; return {

&nbsp;   privateKey: child.privateKey,

&nbsp;   publicKey: child.publicKey,

&nbsp; };

}

```



---



\## crypto/signer.ts



```ts

import nacl from 'tweetnacl';



export function signMessage(message: Uint8Array, privateKey: Uint8Array) {

&nbsp; return nacl.sign.detached(message, privateKey);

}

```



---



\## state/walletStore.ts



```ts

import create from 'zustand';



interface WalletState {

&nbsp; hasWallet: boolean;

&nbsp; address?: string;

&nbsp; setWallet(address: string): void;

&nbsp; clear(): void;

}



export const useWalletStore = create<WalletState>((set) => ({

&nbsp; hasWallet: false,

&nbsp; setWallet: (address) => set({ hasWallet: true, address }),

&nbsp; clear: () => set({ hasWallet: false, address: undefined }),

}));

```



---



\## README.md (Excerpt)



```md

\# HIVE Wallet – Phase 0



Non-custodial mobile wallet for the Honey (HONEY) network.



Phase 0 supports:

\- Wallet creation/import

\- HONEY send/receive

\- Staking \& delegation



No swaps. No fiat. No identity.

```

---



\*\*CODEBASE STATUS:\*\* INITIALIZED – PHASE 0



