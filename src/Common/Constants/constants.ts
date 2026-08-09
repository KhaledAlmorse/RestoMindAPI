export const ImagesExtensions = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.svg',
];

export const ROLES_KEY = 'roles';
export const TOKEN_TYPE_KEY = 'tokenType';

const getApiPublicUrl = () => {
  const url = process.env.API_PUBLIC_URL || 'http://localhost:3004';
  return url.endsWith('/') ? url.slice(0, -1) : url;
};

export const DEFAULT_PLACEHOLDER_IMAGE = {
  public_id: 'default-placeholder',
  get secure_url() {
    return `${getApiPublicUrl()}/public/placeholder.svg`;
  },
};

