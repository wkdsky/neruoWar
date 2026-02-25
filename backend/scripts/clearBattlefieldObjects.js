const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DomainDefenseLayout = require('../models/DomainDefenseLayout');
const Node = require('../models/Node');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/strategy-game';

async function run() {
  await mongoose.connect(MONGODB_URI);
  const now = new Date();

  const domainResult = await DomainDefenseLayout.updateMany(
    {},
    {
      $set: {
        battlefieldObjects: [],
        'battlefieldLayout.objects': [],
        'battlefieldLayout.updatedAt': now,
        updatedAt: now
      }
    }
  );

  const nodeResult = await Node.updateMany(
    {},
    {
      $set: {
        'cityDefenseLayout.battlefieldObjects': [],
        'cityDefenseLayout.battlefieldLayout.objects': [],
        'cityDefenseLayout.battlefieldLayout.updatedAt': now,
        'cityDefenseLayout.updatedAt': now
      }
    }
  );

  const summary = {
    domainDefenseLayoutMatched: domainResult.matchedCount || 0,
    domainDefenseLayoutModified: domainResult.modifiedCount || 0,
    nodeMatched: nodeResult.matchedCount || 0,
    nodeModified: nodeResult.modifiedCount || 0
  };

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('clearBattlefieldObjects failed:', error.message);
  try {
    await mongoose.disconnect();
  } catch (e) {
    // ignore
  }
  process.exit(1);
});
