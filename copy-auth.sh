#!/bin/bash

cp util/auth-original.ts agent-auth-flow/google-adk/util/auth.ts
cp util/auth-original.ts agent-auth-flow/langchain/util/auth.ts
cp util/auth-original.ts on-behalf-of-flow/google-adk/util/auth.ts
cp util/auth-original.ts on-behalf-of-flow/langchain/util/auth.ts