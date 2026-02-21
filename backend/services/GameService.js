const Node = require('../models/Node');
const Army = require('../models/Army');
const Technology = require('../models/Technology');

class GameService {
  // 计算繁荣度
  static calculateProsperity(node, techBonus = 0) {
    const baseResources = node.resources.food + node.resources.metal + node.resources.energy;
    const warDamageFactor = 1 - (node.warDamage / 100);
    const prosperity = Math.log(baseResources + 1) * 10 * (1 + techBonus) * warDamageFactor;
    return Math.min(prosperity, 500); // 最大繁荣度500
  }

  // 计算资源价格
  static calculateResourcePrice(basePrice, distance, risk, demand) {
    const distanceFactor = distance * 0.05;
    const riskFactor = Math.min(risk, 0.3);
    return basePrice * (1 + distanceFactor + riskFactor) * demand;
  }

  // 生产资源
  static async produceResources(node) {
    const now = Date.now();
    const timeDiff = (now - new Date(node.lastUpdate).getTime()) / 1000 / 60; // 分钟
    
    if (timeDiff > 0) {
      node.resources.food += node.productionRates.food * timeDiff;
      node.resources.metal += node.productionRates.metal * timeDiff;
      node.resources.energy += node.productionRates.energy * timeDiff;
      
      node.lastUpdate = now;
      await node.save();
    }
    
    return node;
  }

  // 每秒更新所有节点知识点
  static async updateAllNodesPerSecond() {
    try {
      if (process.env.ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS !== 'true') {
        return [];
      }
      const now = new Date();
      const nodes = await Node.find({});
      const updatedNodes = [];
      
      for (const node of nodes) {
        // 使用UTC时间避免时区问题
        const lastUpdated = new Date(node.knowledgePoint.lastUpdated).getTime();
        const currentTime = now.getTime();
        const secondsElapsed = (currentTime - lastUpdated) / 1000;
        
        if (secondsElapsed > 0) {
          // 计算每秒实际增量
          const increment = secondsElapsed * (node.contentScore / 60);
          node.knowledgePoint.value = parseFloat((node.knowledgePoint.value + increment).toFixed(2));
          node.knowledgePoint.lastUpdated = now;
          
          // 使用批量更新提高性能
          await Node.updateOne(
            { _id: node._id },
            { 
              $set: { 
                "knowledgePoint.value": node.knowledgePoint.value,
                "knowledgePoint.lastUpdated": now
              }
            }
          );
          
          updatedNodes.push({
            _id: node._id,
            knowledgePoint: node.knowledgePoint
          });
        }
      }
      
      console.log(`[${now.toISOString()}] 知识点每秒更新完成，共更新 ${updatedNodes.length} 个节点`);
      return updatedNodes; // 返回更新后的节点数组，用于广播
    } catch (error) {
      console.error('知识点每秒更新失败:', error);
      return [];
    }
  }

  // 获取军队基础属性
  static getArmyStats(type, level) {
    const baseStats = {
      infantry: { attack: 10, defense: 15, speed: 5, cost: { food: 50, metal: 20, energy: 10 } },
      cavalry: { attack: 15, defense: 8, speed: 12, cost: { food: 80, metal: 40, energy: 30 } },
      archer: { attack: 12, defense: 6, speed: 7, cost: { food: 60, metal: 30, energy: 20 } },
      siege: { attack: 25, defense: 20, speed: 3, cost: { food: 100, metal: 80, energy: 60 } }
    };

    const stats = baseStats[type];
    if (!stats) {
      throw new Error('无效的军队类型');
    }

    const levelMultiplier = 1 + (level - 1) * 0.3;

    return {
      attack: Math.floor(stats.attack * levelMultiplier),
      defense: Math.floor(stats.defense * levelMultiplier),
      speed: Math.floor(stats.speed * levelMultiplier),
      cost: stats.cost
    };
  }

  // 升级科技
  static async upgradeTechnology(userId, techId) {
    let tech = await Technology.findOne({ userId, techId });
    
    if (!tech) {
      const techData = this.getTechnologyData(techId);
      tech = new Technology({
        userId,
        techId,
        ...techData
      });
    }

    tech.level += 1;
    tech.unlockCost.food = Math.floor(tech.unlockCost.food * 1.5);
    tech.unlockCost.metal = Math.floor(tech.unlockCost.metal * 1.5);
    tech.unlockCost.energy = Math.floor(tech.unlockCost.energy * 1.5);

    await tech.save();
    return tech;
  }

  // 获取科技数据
  static getTechnologyData(techId) {
    const techs = {
      'agriculture': {
        name: '农业科技',
        unlockCost: { food: 500, metal: 200, energy: 100 },
        effects: { prosperityBonus: 0.1, productionBonus: 0.2, militaryBonus: 0 }
      },
      'metallurgy': {
      name: '冶金学',
        unlockCost: { food: 300, metal: 600, energy: 200 },
        effects: { prosperityBonus: 0.05, productionBonus: 0.15, militaryBonus: 0.1 }
      },
      'warfare': {
        name: '军事学',
        unlockCost: { food: 400, metal: 400, energy: 300 },
        effects: { prosperityBonus: 0, productionBonus: 0, militaryBonus: 0.25 }
      },
      'engineering': {
        name: '工程学',
        unlockCost: { food: 600, metal: 500, energy: 400 },
        effects: { prosperityBonus: 0.15, productionBonus: 0.1, militaryBonus: 0.05 }
      }
    };

    return techs[techId] || techs['agriculture'];
  }

  // 计算两个节点之间的距离
  static calculateDistance(node1, node2) {
    const dx = node1.position.x - node2.position.x;
    const dy = node1.position.y - node2.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 验证资源是否足够
  static hasEnoughResources(node, cost) {
    return node.resources.food >= cost.food &&
           node.resources.metal >= cost.metal &&
           node.resources.energy >= cost.energy;
  }

  // 扣除资源
  static async deductResources(node, cost) {
    node.resources.food -= cost.food;
    node.resources.metal -= cost.metal;
    node.resources.energy -= cost.energy;
    await node.save();
    return node;
  }

  // 更新所有节点的知识点值
  static async updateKnowledgePoints() {
    try {
      if (process.env.ENABLE_LEGACY_KNOWLEDGEPOINT_TICKS !== 'true') {
        return;
      }
      const nodes = await Node.find({});
      for (const node of nodes) {
        await Node.updateKnowledgePoint(node._id);
      }
      console.log(`[${new Date().toISOString()}] 知识点更新完成，共更新 ${nodes.length} 个节点`);
    } catch (error) {
      console.error('知识点更新失败:', error);
    }
  }
}

module.exports = GameService;
