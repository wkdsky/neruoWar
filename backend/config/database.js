const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 80,
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE, 10) || 10,
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 5000,
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 45000,
        maxIdleTimeMS: parseInt(process.env.MONGODB_MAX_IDLE_TIME_MS, 10) || 30000,
      }
    );

    console.log(`MongoDB 连接成功: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB 连接错误: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
