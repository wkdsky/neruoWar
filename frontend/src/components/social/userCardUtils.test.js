import { getUserId } from './userCardUtils';

describe('userCardUtils', () => {
  test('prefers canonical userId over wrapper _id', () => {
    expect(getUserId({
      _id: 'wrapper-record-id',
      userId: '507f191e810c19729de860ea',
      username: 'alice'
    })).toBe('507f191e810c19729de860ea');
  });

  test('falls back to nested user identity', () => {
    expect(getUserId({
      friendshipId: 'friendship-row',
      user: {
        _id: '507f191e810c19729de860eb',
        username: 'bob'
      }
    })).toBe('507f191e810c19729de860eb');
  });
});
