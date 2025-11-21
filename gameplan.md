tomorrow:

research: instances of an agent with hedera agent kit. Possible project dash threshold creation with agent signers. Validator could be the same agent for all projects, signer agent will need to be unique accounts per project with different clients (?) but same server instance for now.

Validator Agent

~~1. copy in basic struct, configs and setup files from balancer agent~~
~~2. create threshold list with this agent assigned along with testnet accounts of mine~~
~~3. Define the needed project details on the existing projects HCS topic. Make sure it has the operator account for the project threshold list ID. Every relevant contract or token address as well.~~
~~3.a Publish a placeholder audit message which includes the project transaction ID as well as the names of the contracts.~~
~~4. Load the agent with the project details (GET_TOPIC_MESSAGES_QUERY_TOOL) as well as the contract source and ABI files (locally)~~
~~5. inspect each pending transaction on the threshold list and publish an HCS2 indexed message with analysis and risk level~~
~~5.a create tool for fetching pending transactions~~

5.b create topic for transaction validator agent

~~5.c create topic for transaction rejection~~
~~6. If the risk is medium to low and within the normal bounds of transactions for the project then approve the transaction.~~
7. post the risk level and analysis in a message on a new topic for Validator Agent

The validator should specifically insure that the scheduled transaction gives signers a min period of 3 days.

Signer Agent

The signer agent will not use LLM but rather conditionally sign any transaction that doesn't have any HCS rejections, from users or validator agent, in the threshold's topic once it's near the end of the schedule. Thus it will vote with the validator agent and pass a transaction with inactive signers. The signer accounts will also enforce automatically switching to new threshold lists when they expire or when signers are frequently inactive.

Auditor Agent

The Auditor will review every contract's source code for a project and post in an audit topic for each project. This audit will be displayed in each transaction detail view in the signers dash.