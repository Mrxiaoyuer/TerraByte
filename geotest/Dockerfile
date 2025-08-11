# Build stage
FROM node:18-alpine AS builder
WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copy source and build
COPY . .
RUN npm run build

# Runtime stage
FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy app from builder
COPY --from=builder /app /app

# Expose port
EXPOSE 3000

# Start Next.js in production mode
CMD ["npm", "run", "start"]
