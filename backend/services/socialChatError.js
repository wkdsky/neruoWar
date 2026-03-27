class SocialChatError extends Error {
  constructor(message, {
    status = 400,
    code = 'SOCIAL_CHAT_ERROR',
    details = null
  } = {}) {
    super(message);
    this.name = 'SocialChatError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = SocialChatError;
