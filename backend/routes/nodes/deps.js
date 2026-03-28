module.exports = ({
  models = {},
  platform = {},
  state = {},
  projections = {},
  search = {},
  auth = {},
  permissions = {},
  defense = {},
  siege = {},
  distribution = {},
  associations = {}
}) => ({
  ...models,
  ...platform,
  ...state,
  ...projections,
  ...search,
  ...auth,
  ...permissions,
  ...defense,
  ...siege,
  ...distribution,
  ...associations
});
