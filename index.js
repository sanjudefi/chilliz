require('dotenv').config();
const Web3 = require('web3');
const express = require('express');
const mysql = require('mysql2/promise');
const app = express();
//const web3 = new Web3(process.env.INFURA_URL);
const web3 = new Web3(new Web3.providers.WebsocketProvider(process.env.INFURA_URL, {
    clientConfig: {
        maxReceivedFrameSize: 100000000,
        maxReceivedMessageSize: 100000000,
    }
}));

const transferMethodABI = {
    name: 'transfer',
    type: 'function',
    inputs: [{
        type: 'address',
        name: 'to'
    }, {
        type: 'uint256',
        name: 'value'
    }]
};


// MySQL connection setup
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const CHZ_TOKEN_ADDRESS = '0x3506424f91fd33084466f402d5d97f05f8e3b4af'.toLowerCase();
let lastProcessedBlock = process.env.START_BLOCK || 'latest';
/* 
async function processBlock(blockNumber) {
    try {
        const block = await web3.eth.getBlock(blockNumber, true);

        for (const tx of block.transactions) {
            console.log(tx);
            if (tx.to && tx.to.toLowerCase() === CHZ_TOKEN_ADDRESS) {
                const query = `INSERT IGNORE INTO chz_transactions (hash, blockNumber, \`from\`, \`to\`, amount, timestamp) VALUES (?, ?, ?, ?, ?, ?)`;
                const values = [tx.hash, tx.blockNumber, tx.from, tx.to, tx.value.toString(), new Date()];
                await pool.query(query, values);
            }
        }
        lastProcessedBlock = blockNumber;
        console.log(`Processed block ${blockNumber}`);
    } catch (error) {
        console.error(`Error processing block ${blockNumber}:`, error);
    }
} */

async function processBlock(blockNumber) {
    try {
        const block = await web3.eth.getBlock(blockNumber, true);

        for (const tx of block.transactions) {
            if (tx.to && tx.to.toLowerCase() === CHZ_TOKEN_ADDRESS) {
                let tokenAmount = '0'; // Default to 0 if not a token transfer or can't decode

                // Attempt to decode token transfer amount if input data is present
                if (tx.input && tx.input !== '0x') {
                    const methodSignature = tx.input.slice(0, 10);
                    const encodedParams = tx.input.slice(10);
                    if (methodSignature === web3.eth.abi.encodeFunctionSignature(transferMethodABI)) {
                        const params = web3.eth.abi.decodeParameters(transferMethodABI.inputs, encodedParams);
                        tokenAmount = params.value.toString();
                    }
                }

                const query = `INSERT IGNORE INTO chz_transactions (hash, blockNumber, \`from\`, \`to\`, amount, tokenAmount, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`;
                const values = [tx.hash, tx.blockNumber, tx.from, tx.to, tx.value.toString(), tokenAmount, new Date()];
                await pool.query(query, values);
            }
        }
        lastProcessedBlock = blockNumber;
        console.log(`Processed block ${blockNumber}`);
    } catch (error) {
        console.error(`Error processing block ${blockNumber}:`, error);
    }
}

function startListening() {
    web3.eth.subscribe('newBlockHeaders', async (error, blockHeader) => {
        if (error) {
            console.error('Error subscribing to newBlockHeaders:', error);
            return;
        }
        await processBlock(blockHeader.number);
    });
}

app.get('/api/total-chz-transferred', async (req, res) => {
    const [result] = await pool.query(`SELECT SUM(amount) AS totalAmount FROM chz_transactions`);
    res.json({ totalAmountTransferred: result[0].totalAmount || 0 });
});

app.get('/api/transaction/:hash', async (req, res) => {
    const [transaction] = await pool.query(`SELECT * FROM chz_transactions WHERE hash = ?`, [req.params.hash]);
    res.json({ interactsWithCHZ: transaction.length > 0 });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startListening();
});
