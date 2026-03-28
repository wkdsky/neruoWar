export const parseApiResponse = async (response) => {
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch (e) {
    data = null;
  }
  return { response, data, rawText };
};

export const getApiError = (parsed, fallback) => (
  parsed?.data?.error ||
  parsed?.data?.message ||
  fallback
);
