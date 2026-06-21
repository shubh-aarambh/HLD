# Use lightweight official Node Alpine image
FROM node:22-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package descriptors first to leverage Docker layer caching
COPY package*.json ./

# Install all production and dev dependencies (needed for tsx runtime compiling)
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose backend server port
EXPOSE 3000

# Script to run dataset seeding first, then start the Express server
CMD ["sh", "-c", "npm run seed && npm start"]
