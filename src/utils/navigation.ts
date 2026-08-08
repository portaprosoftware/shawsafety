// An array of links for navigation bar
const navBarLinks = [
  { name: 'Shop Safety Ties', url: '/products/11-inch-zip-tie-100-pack' },
  { name: 'Shop Safety Vests', url: '/safety-vests' },
  { name: 'Wholesale', url: '/wholesale' },
];

// An array of links for footer
const footerLinks = [
  {
    section: 'Shop',
    links: [
      { name: 'Safety Ties', url: '/products/11-inch-zip-tie-100-pack' },
      { name: 'Safety Vests', url: '/safety-vests' },
      { name: 'All Products', url: '/products' },
      { name: 'Wholesale Pricing', url: '/wholesale' },
    ],
  },
  {
    section: 'Company',
    links: [
      { name: 'About Shaw Safety', url: '/about' },
      { name: 'Contact', url: '/contact' },
      { name: 'Shipping & Returns', url: '/contact#shipping' },
      { name: 'Bulk Quote Request', url: '/wholesale#quote' },
    ],
  },
];

// An object of links for social icons
const socialLinks = {
  facebook: 'https://www.facebook.com/',
  x: 'https://twitter.com/',
  google: 'https://www.google.com/',
};

export default {
  navBarLinks,
  footerLinks,
  socialLinks,
};
