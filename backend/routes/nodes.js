const express = require('express');
const router = express.Router();
const { deps: nodeRouteModuleDeps } = require('./nodes/context');
const registerNodePublicRoutes = require('./nodes/public');
const registerNodeGovernanceRoutes = require('./nodes/governance');
const registerNodeDefenseRoutes = require('./nodes/defense');
const registerNodeSiegeRoutes = require('./nodes/siege');
const registerNodeDistributionRoutes = require('./nodes/distribution');
const registerNodeModerationRoutes = require('./nodes/moderation');
const registerNodeAdminRoutes = require('./nodes/admin');
const registerNodeAssociationRoutes = require('./nodes/associations');
const registerNodeCoreRoutes = require('./nodes/core');

registerNodePublicRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeGovernanceRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeDefenseRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeSiegeRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeDistributionRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeModerationRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeAdminRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeAssociationRoutes({ router, deps: nodeRouteModuleDeps });
registerNodeCoreRoutes({ router, deps: nodeRouteModuleDeps });

module.exports = router;
