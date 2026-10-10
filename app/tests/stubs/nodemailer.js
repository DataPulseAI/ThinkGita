// Stand-in for npm:nodemailer in unit tests: records messages instead of sending them.
export const sent = [];
export default { createTransport: () => ({ sendMail: async (m) => { sent.push(m); return { messageId: `test-${sent.length}` }; } }) };
