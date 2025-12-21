/**
 * 迁移脚本：移除 Node 集合中 name 字段的唯一索引
 *
 * 运行方式：node backend/scripts/removeNameUniqueIndex.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function removeNameUniqueIndex() {
    try {
        console.log('连接到 MongoDB:', MONGODB_URI);
        await mongoose.connect(MONGODB_URI);
        console.log('连接成功！');

        const db = mongoose.connection.db;
        const collection = db.collection('nodes');

        // 获取当前索引
        console.log('\n当前索引：');
        const indexes = await collection.indexes();
        indexes.forEach(idx => {
            console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
        });

        // 查找并删除 name 字段的唯一索引
        const nameIndex = indexes.find(idx => idx.key && idx.key.name && idx.unique);

        if (nameIndex) {
            console.log(`\n找到 name 唯一索引：${nameIndex.name}`);
            console.log('正在删除...');
            await collection.dropIndex(nameIndex.name);
            console.log('删除成功！');
        } else {
            console.log('\n未找到 name 字段的唯一索引，可能已经删除。');
        }

        // 验证删除
        console.log('\n删除后的索引：');
        const newIndexes = await collection.indexes();
        newIndexes.forEach(idx => {
            console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
        });

        console.log('\n迁移完成！');
    } catch (error) {
        console.error('迁移失败：', error);
    } finally {
        await mongoose.disconnect();
        console.log('已断开数据库连接。');
    }
}

removeNameUniqueIndex();
