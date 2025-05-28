# Contract Tools (NestJS Backend)

This subproject provides a NestJS-based backend API service for deploying and interacting with Wasm-based smart contracts on the OYL network. It is built with NestJS and utilizes the `oylsdk` for its core blockchain operations.

## Installation

To get started, clone the main repository if you haven't already, navigate to this subproject's directory, and install the dependencies:

```bash
# Assuming you are in the root of the main project (oylsdk)
cd contract-tools
npm install
# or
# yarn install
```

## Running the application

### Development Mode

To run the application in development mode with live reloading:

```bash
npm run start:dev
# or
# yarn start:dev
```
The server will start, typically on `http://localhost:3000`. Changes to source files will trigger a rebuild and server restart.

### Production Mode

To build and run the application in production mode:

```bash
# 1. Build the application
npm run build

# 2. Start the production server
npm run start:prod
```

## Running Tests

### Unit Tests

To run the unit tests (typically `.spec.ts` files located alongside the source files):

```bash
npm run test
```

### End-to-End (E2E) Tests

NestJS also supports E2E tests. If configured, they can be run with:

```bash
npm run test:e2e
```
(Note: E2E test setup is standard in NestJS but specific tests for this project would need to be written.)

## API Endpoints

All API endpoints provided by this service are prefixed with `/contracts`. The service typically runs on `http://localhost:3000`.

-   **`POST /contracts/preDeploy`**
    -   **Purpose**: Calculates potential deployment costs for a Wasm contract and returns a PSBT (Partially Signed Bitcoin Transaction) for the commit transaction, along with a mnemonic. The user signs this PSBT with their wallet.
    -   **Request Body**: Should conform to `PreDeployDto`. Key fields include:
        -   `contractName` (string): Name of the contract (used to identify Wasm file, e.g., "my_contract" for "my_contract.wasm").
        -   `symbol` (string): Token symbol for the contract.
        -   `totalSupply` (number): Total supply for the token.
    -   **Response**: Contains the PSBT (base64), mnemonic, estimated fees, and recipient address.

-   **`POST /contracts/deploy`**
    -   **Purpose**: Deploys a Wasm contract to the chain. This involves broadcasting the user-signed commit transaction and then creating, signing, and broadcasting the reveal transaction which contains the contract code and its initialization parameters.
    -   **Request Body**: Should conform to `DeployDto`. Key fields include:
        -   `signedCommitPsbtBase64` (string): The PSBT from the `/preDeploy` step, now signed by the user.
        -   `mnemonic` (string): The mnemonic generated during `/preDeploy` (associated with the deployer account for the contract).
        -   `contractName` (string): Name of the contract (e.g., "my_contract" for "my_contract.wasm").
        -   `symbol` (string): Token symbol.
        -   `totalSupply` (number): Total supply.
        -   `decimals` (number, optional): Token decimals (defaults to 0).
    -   **Response**: Contains `commitTxId`, `revealTxId`, `contractId`, and `alkaneId`.

-   **`POST /contracts/execute`**
    -   **Purpose**: Executes a specified method on an already deployed Wasm contract.
    -   **Request Body**: Should conform to `ExecuteDto`. Key fields include:
        -   `contractId` (string): The ID of the contract to interact with (format: "revealTxId:vout").
        -   `methodName` (string): The name of the contract method to execute.
        -   `args` (array): An array of arguments to pass to the contract method.
        -   `mnemonic` (string): The mnemonic of the account executing the method (used for signing and fee payment).
        -   `feeAddress` (string, optional): Address for collecting frontend fees, if any.
        -   `frontendFee` (number, optional): Amount of frontend fee in satoshis.
    -   **Response**: Contains the `executionTxId`.

For detailed request payload structures, refer to the DTO (Data Transfer Object) files located in `src/contracts/dto/`.

## Project Structure

-   `src/`: Contains the application source code.
    -   `main.ts`: Application entry point, initializes NestJS.
    -   `app.module.ts`: Root application module.
    -   `contracts/`: Module for contract-related operations.
        -   `contracts.module.ts`: Defines the `ContractsModule`.
        -   `contracts.controller.ts`: Defines API routes and delegates to `ContractsService`.
        -   `contracts.service.ts`: Contains the business logic for interacting with `oylsdk`.
        -   `dto/`: Contains DTOs for request body validation.
-   `test/`: Contains E2E tests (if any).
-   `wasm/`: Directory for storing Wasm contract files (e.g., `placeholder_contract_1.wasm`). This directory is expected at the root of the `contract-tools` project.

## Key Dependencies
-   **NestJS**: Framework for building efficient, scalable Node.js server-side applications.
-   **oylsdk**: The OYL SDK used for all Bitcoin and contract-specific operations.
-   **class-validator**, **class-transformer**: For request payload validation and transformation.
