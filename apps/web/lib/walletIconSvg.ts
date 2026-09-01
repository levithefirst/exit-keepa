/**
 * Real, official wallet logomarks, embedded inline (no external image
 * fetch, no runtime CDN dependency) - sourced verbatim from RainbowKit
 * (github.com/rainbow-me/rainbowkit, MIT licensed), the standard
 * open-source home for exactly this kind of wallet-connector iconography.
 * Not letter-monogram placeholders: these are the wallets own brand marks.
 *
 * Two normalizations applied to the raw source, both load-bearing:
 *  - width/height forced to 100% (viewBox left untouched) so each icon
 *    fills whatever square wrapper renders it, regardless of its original
 *    source dimensions (28px badges vs. Brave's 2770px artwork).
 *  - every internal id= (gradients, clip-paths) is namespaced per wallet.
 *    SVG ids are resolved document-globally, not scoped to their own
 *    <svg> subtree - multiple of these strings land in the same DOM via
 *    dangerouslySetInnerHTML, so an unprefixed id="a" in one wallet's
 *    markup silently wins the reference in *another* wallet's
 *    fill="url(#a)" (this really happened: MetaMask's clipPath id="a"
 *    was shadowing Brave's gradient id="a", rendering Brave blank).
 */
export const WALLET_ICON_SVG: Record<string, string> = {
  MetaMask: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" fill="none" viewBox="0 0 28 28"><path fill="#fff" d="M0 0h28v28H0z"/><g clip-path="url(#metamask-a)"><path fill="#ff5c16" d="m24.024 23.824-4.846-1.434-3.655 2.172-2.55-.001-3.656-2.171-4.844 1.434L3 18.88l1.473-5.488L3 8.751 4.473 3l7.569 4.496h4.413L24.024 3l1.473 5.751-1.473 4.64 1.473 5.488z"/><path fill="#ff5c16" d="m4.474 3 7.57 4.499-.302 3.087zm4.844 15.881 3.33 2.522-3.33.987zm3.064-4.17-.64-4.123-4.097 2.804h-.002v.001l.013 2.886 1.661-1.567zM24.024 3l-7.57 4.499.3 3.087zM19.18 18.881l-3.33 2.522 3.33.987zm1.674-5.488v-.002zl-4.097-2.804-.64 4.124h3.064l1.662 1.567z"/><path fill="#e34807" d="m9.317 22.39-4.844 1.434L3 18.881h6.317zm3.064-7.68.925 5.962-1.282-3.315-4.37-1.078 1.662-1.568zm6.799 7.68 4.844 1.434 1.473-4.943H19.18zm-3.064-7.68-.925 5.962 1.282-3.315 4.37-1.078-1.663-1.568z"/><path fill="#ff8d5d" d="m3 18.88 1.473-5.489h3.169l.012 2.887 4.37 1.078 1.282 3.314-.659.73-3.33-2.522H3zm22.497 0-1.473-5.489h-3.17l-.01 2.887-4.371 1.078-1.282 3.314.659.73 3.33-2.522h6.317zM16.455 7.495h-4.413l-.3 3.087 1.565 10.084h1.884l1.565-10.084z"/><path fill="#661800" d="M4.473 3 3 8.751l1.473 4.64h3.169l4.1-2.805zm6.992 12.908H10.03l-.781.761 2.776.685-.56-1.447M24.024 3l1.473 5.751-1.473 4.64h-3.17l-4.098-2.805zm-6.99 12.908h1.437l.782.762-2.78.686.56-1.45zm-1.512 6.687.328-1.193-.66-.73h-1.885l-.659.73.327 1.192"/><path fill="#c0c4cd" d="M15.522 22.594v1.969h-2.548v-1.969z"/><path fill="#e7ebf6" d="m9.318 22.388 3.658 2.174v-1.969l-.328-1.192zm9.862 0-3.658 2.174v-1.969l.328-1.192z"/></g><defs><clipPath id="metamask-a"><path fill="#fff" d="M3 3h22.5v21.563H3z"/></clipPath></defs></svg>`,
  CoinbaseWallet: `<svg width="100%" height="100%" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="28" height="28" fill="#2C5FF6"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M14 23.8C19.4124 23.8 23.8 19.4124 23.8 14C23.8 8.58761 19.4124 4.2 14 4.2C8.58761 4.2 4.2 8.58761 4.2 14C4.2 19.4124 8.58761 23.8 14 23.8ZM11.55 10.8C11.1358 10.8 10.8 11.1358 10.8 11.55V16.45C10.8 16.8642 11.1358 17.2 11.55 17.2H16.45C16.8642 17.2 17.2 16.8642 17.2 16.45V11.55C17.2 11.1358 16.8642 10.8 16.45 10.8H11.55Z" fill="white"/>
</svg>`,
  WalletConnect: `<svg width="100%" height="100%" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="28" height="28" fill="#3B99FC"/>
<path d="M8.38969 10.3739C11.4882 7.27538 16.5118 7.27538 19.6103 10.3739L19.9832 10.7468C20.1382 10.9017 20.1382 11.1529 19.9832 11.3078L18.7076 12.5835C18.6301 12.6609 18.5045 12.6609 18.4271 12.5835L17.9139 12.0703C15.7523 9.9087 12.2477 9.9087 10.0861 12.0703L9.53655 12.6198C9.45909 12.6973 9.3335 12.6973 9.25604 12.6198L7.98039 11.3442C7.82547 11.1893 7.82547 10.9381 7.98039 10.7832L8.38969 10.3739ZM22.2485 13.012L23.3838 14.1474C23.5387 14.3023 23.5387 14.5535 23.3838 14.7084L18.2645 19.8277C18.1096 19.9827 17.8584 19.9827 17.7035 19.8277C17.7035 19.8277 17.7035 19.8277 17.7035 19.8277L14.0702 16.1944C14.0314 16.1557 13.9686 16.1557 13.9299 16.1944C13.9299 16.1944 13.9299 16.1944 13.9299 16.1944L10.2966 19.8277C10.1417 19.9827 9.89053 19.9827 9.73561 19.8278C9.7356 19.8278 9.7356 19.8277 9.7356 19.8277L4.61619 14.7083C4.46127 14.5534 4.46127 14.3022 4.61619 14.1473L5.75152 13.012C5.90645 12.857 6.15763 12.857 6.31255 13.012L9.94595 16.6454C9.98468 16.6841 10.0475 16.6841 10.0862 16.6454C10.0862 16.6454 10.0862 16.6454 10.0862 16.6454L13.7194 13.012C13.8743 12.857 14.1255 12.857 14.2805 13.012C14.2805 13.012 14.2805 13.012 14.2805 13.012L17.9139 16.6454C17.9526 16.6841 18.0154 16.6841 18.0541 16.6454L21.6874 13.012C21.8424 12.8571 22.0936 12.8571 22.2485 13.012Z" fill="white"/>
</svg>`,
  Rainbow: `<svg width="100%" height="100%" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="120" height="120" fill="url(#rainbow-paint0_linear_62_329)"/>
<path d="M20 38H26C56.9279 38 82 63.0721 82 94V100H94C97.3137 100 100 97.3137 100 94C100 53.1309 66.8691 20 26 20C22.6863 20 20 22.6863 20 26V38Z" fill="url(#rainbow-paint1_radial_62_329)"/>
<path d="M84 94H100C100 97.3137 97.3137 100 94 100H84V94Z" fill="url(#rainbow-paint2_linear_62_329)"/>
<path d="M26 20L26 36H20L20 26C20 22.6863 22.6863 20 26 20Z" fill="url(#rainbow-paint3_linear_62_329)"/>
<path d="M20 36H26C58.0325 36 84 61.9675 84 94V100H66V94C66 71.9086 48.0914 54 26 54H20V36Z" fill="url(#rainbow-paint4_radial_62_329)"/>
<path d="M68 94H84V100H68V94Z" fill="url(#rainbow-paint5_linear_62_329)"/>
<path d="M20 52L20 36L26 36L26 52H20Z" fill="url(#rainbow-paint6_linear_62_329)"/>
<path d="M20 62C20 65.3137 22.6863 68 26 68C40.3594 68 52 79.6406 52 94C52 97.3137 54.6863 100 58 100H68V94C68 70.804 49.196 52 26 52H20V62Z" fill="url(#rainbow-paint7_radial_62_329)"/>
<path d="M52 94H68V100H58C54.6863 100 52 97.3137 52 94Z" fill="url(#rainbow-paint8_radial_62_329)"/>
<path d="M26 68C22.6863 68 20 65.3137 20 62L20 52L26 52L26 68Z" fill="url(#rainbow-paint9_radial_62_329)"/>
<defs>
<linearGradient id="rainbow-paint0_linear_62_329" x1="60" y1="0" x2="60" y2="120" gradientUnits="userSpaceOnUse">
<stop stop-color="#174299"/>
<stop offset="1" stop-color="#001E59"/>
</linearGradient>
<radialGradient id="rainbow-paint1_radial_62_329" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(74)">
<stop offset="0.770277" stop-color="#FF4000"/>
<stop offset="1" stop-color="#8754C9"/>
</radialGradient>
<linearGradient id="rainbow-paint2_linear_62_329" x1="83" y1="97" x2="100" y2="97" gradientUnits="userSpaceOnUse">
<stop stop-color="#FF4000"/>
<stop offset="1" stop-color="#8754C9"/>
</linearGradient>
<linearGradient id="rainbow-paint3_linear_62_329" x1="23" y1="20" x2="23" y2="37" gradientUnits="userSpaceOnUse">
<stop stop-color="#8754C9"/>
<stop offset="1" stop-color="#FF4000"/>
</linearGradient>
<radialGradient id="rainbow-paint4_radial_62_329" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(58)">
<stop offset="0.723929" stop-color="#FFF700"/>
<stop offset="1" stop-color="#FF9901"/>
</radialGradient>
<linearGradient id="rainbow-paint5_linear_62_329" x1="68" y1="97" x2="84" y2="97" gradientUnits="userSpaceOnUse">
<stop stop-color="#FFF700"/>
<stop offset="1" stop-color="#FF9901"/>
</linearGradient>
<linearGradient id="rainbow-paint6_linear_62_329" x1="23" y1="52" x2="23" y2="36" gradientUnits="userSpaceOnUse">
<stop stop-color="#FFF700"/>
<stop offset="1" stop-color="#FF9901"/>
</linearGradient>
<radialGradient id="rainbow-paint7_radial_62_329" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(42)">
<stop offset="0.59513" stop-color="#00AAFF"/>
<stop offset="1" stop-color="#01DA40"/>
</radialGradient>
<radialGradient id="rainbow-paint8_radial_62_329" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(51 97) scale(17 45.3333)">
<stop stop-color="#00AAFF"/>
<stop offset="1" stop-color="#01DA40"/>
</radialGradient>
<radialGradient id="rainbow-paint9_radial_62_329" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(23 69) rotate(-90) scale(17 322.37)">
<stop stop-color="#00AAFF"/>
<stop offset="1" stop-color="#01DA40"/>
</radialGradient>
</defs>
</svg>`,
  TrustWallet: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" width="100%" height="100%" viewBox="0 0 28 28"><path fill="#fff" d="M0 0h28v28H0z"/><path fill="#0500FF" d="M6 7.583 13.53 5v17.882C8.15 20.498 6 15.928 6 13.345V7.583Z"/><path fill="url(#trustwallet-a)" d="M22 7.583 13.53 5v17.882c6.05-2.384 8.47-6.954 8.47-9.537V7.583Z"/><defs><linearGradient id="trustwallet-a" x1="19.768" x2="14.072" y1="3.753" y2="22.853" gradientUnits="userSpaceOnUse"><stop offset=".02" stop-color="#00F"/><stop offset=".08" stop-color="#0094FF"/><stop offset=".16" stop-color="#48FF91"/><stop offset=".42" stop-color="#0094FF"/><stop offset=".68" stop-color="#0038FF"/><stop offset=".9" stop-color="#0500FF"/></linearGradient></defs></svg>`,
  Rabby: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 28 28"><g clip-path="url(#rabby-a)"><path fill="#8697FF" d="M28 0H0v28h28V0Z"/><path fill="url(#rabby-b)" d="M22.54 15.078c.677-1.514-2.673-5.744-5.874-7.506-2.017-1.365-4.12-1.178-4.545-.579-.935 1.316 3.094 2.43 5.788 3.731-.58.252-1.125.703-1.446 1.28-1.004-1.096-3.209-2.04-5.796-1.28-1.743.513-3.191 1.721-3.751 3.546a1.097 1.097 0 1 0-.445 2.1c.112 0 .463-.075.463-.075l5.612.041c-2.244 3.56-4.018 4.081-4.018 4.698s1.697.45 2.335.22c3.05-1.1 6.327-4.531 6.89-5.519 2.36.295 4.345.33 4.786-.657Z"/><path fill="url(#rabby-c)" fill-rule="evenodd" d="m17.885 10.713.025.01c.125-.049.105-.233.07-.378-.078-.333-1.438-1.676-2.715-2.277-1.743-.82-3.025-.777-3.212-.398.356.726 1.998 1.408 3.714 2.12.723.3 1.46.606 2.118.923Z" clip-rule="evenodd"/><path fill="url(#rabby-d)" fill-rule="evenodd" d="M15.701 18.036a10.296 10.296 0 0 0-1.2-.37c.482-.862.583-2.138.128-2.945-.639-1.133-1.44-1.736-3.304-1.736-1.024 0-3.783.346-3.832 2.648-.005.242 0 .464.017.667l5.036.037a17.264 17.264 0 0 1-1.871 2.483c.669.172 1.221.316 1.728.448.48.125.92.24 1.38.357a21.003 21.003 0 0 0 1.918-1.59Z" clip-rule="evenodd"/><path fill="url(#rabby-e)" d="M6.848 16.063c.206 1.75 1.2 2.435 3.232 2.638 2.032.203 3.197.067 4.749.208 1.296.118 2.453.778 2.882.55.386-.205.17-.947-.347-1.423-.67-.617-1.597-1.046-3.229-1.199.325-.89.234-2.138-.27-2.817-.731-.982-2.079-1.426-3.785-1.232-1.782.202-3.49 1.08-3.232 3.275Z"/></g><defs><linearGradient id="rabby-b" x1="10.464" x2="22.394" y1="13.737" y2="17.12" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient><linearGradient id="rabby-c" x1="20.386" x2="11.779" y1="13.509" y2="4.879" gradientUnits="userSpaceOnUse"><stop stop-color="#7258DC"/><stop offset="1" stop-color="#797DEA" stop-opacity="0"/></linearGradient><linearGradient id="rabby-d" x1="15.94" x2="7.673" y1="18.337" y2="13.584" gradientUnits="userSpaceOnUse"><stop stop-color="#7461EA"/><stop offset="1" stop-color="#BFC2FF" stop-opacity="0"/></linearGradient><linearGradient id="rabby-e" x1="11.177" x2="16.765" y1="13.648" y2="20.749" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".984" stop-color="#D5CEFF"/></linearGradient><clipPath id="rabby-a"><path fill="#fff" d="M0 0h28v28H0z"/></clipPath></defs></svg>`,
  OkxWallet: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 28 28"><path fill="#000" d="M0 0h28v28H0z"/><path fill="#fff" fill-rule="evenodd" d="M10.819 5.556H5.93a.376.376 0 0 0-.375.375v4.888c0 .207.168.375.375.375h4.888a.376.376 0 0 0 .375-.376V5.932a.376.376 0 0 0-.376-.375Zm5.64 5.638h-4.886a.376.376 0 0 0-.376.376v4.887c0 .208.168.376.376.376h4.887a.376.376 0 0 0 .376-.375V11.57a.376.376 0 0 0-.376-.377Zm.75-5.638h4.887c.208 0 .376.168.376.375v4.888a.376.376 0 0 1-.376.375H17.21a.376.376 0 0 1-.376-.376V5.933c0-.208.169-.376.376-.376Zm-6.39 11.277H5.93a.376.376 0 0 0-.375.376v4.887c0 .208.168.376.375.376h4.888a.376.376 0 0 0 .375-.376V17.21a.376.376 0 0 0-.376-.376Zm6.39 0h4.887c.208 0 .376.169.376.376v4.887a.376.376 0 0 1-.376.376H17.21a.376.376 0 0 1-.376-.376V17.21c0-.207.169-.376.376-.376Z" clip-rule="evenodd"/></svg>`,
  BraveWallet: `<svg width="100%" height="100%" viewBox="-100 -100 2970 2970" xmlns="http://www.w3.org/2000/svg" style="background-color:white"><linearGradient id="bravewallet-a" y1="51%" y2="51%"><stop offset=".4" stop-color="#f50"/><stop offset=".6" stop-color="#ff2000"/></linearGradient><linearGradient id="bravewallet-b" x1="2%" y1="51%" y2="51%"><stop offset="0" stop-color="#ff452a"/><stop offset="1" stop-color="#ff2000"/></linearGradient><path fill="url(#bravewallet-a)" d="m2395 723 60-147-170-176c-92-92-288-38-288-38l-222-252H992L769 363s-196-53-288 37L311 575l60 147-75 218 250 953c52 204 87 283 234 387l457 310c44 27 98 74 147 74s103-47 147-74l457-310c147-104 182-183 234-387l250-953z"/><path fill="#fff" d="M1935 524s287 347 287 420c0 75-36 94-72 133l-215 230c-20 20-63 54-38 113 25 60 60 134 20 210-40 77-110 128-155 120a820 820 0 0 1-190-90c-38-25-160-126-160-165s126-110 150-124c23-16 130-78 132-102s2-30-30-90-88-140-80-192c10-52 100-80 167-105l207-78c16-8 12-15-36-20-48-4-183-22-244-5s-163 43-173 57c-8 14-16 14-7 62l58 315c4 40 12 67-30 77-44 10-117 27-142 27s-99-17-142-27-35-37-30-77c4-40 48-268 57-315 10-48 1-48-7-62-10-14-113-40-174-57-60-17-196 1-244 6-48 4-52 10-36 20l207 77c66 25 158 53 167 105 10 53-47 132-80 192s-32 66-30 90 110 86 132 102c24 15 150 85 150 124s-119 140-159 165a820 820 0 0 1-190 90c-45 8-115-43-156-120-40-76-4-150 20-210 25-60-17-92-38-113l-215-230c-35-37-71-57-71-131s287-420 287-420l273 44c32 0 103-27 168-50 65-20 110-22 110-22s44 0 110 22 136 50 168 50c33 0 275-47 275-47zm-215 1328c18 10 7 32-10 44l-254 198c-20 20-52 50-73 50s-52-30-73-50a13200 13200 0 0 0-255-198c-16-12-27-33-10-44l150-80a870 870 0 0 1 188-73c15 0 110 34 187 73l150 80z"/><path fill="url(#bravewallet-b)" d="m1999 363-224-253H992L769 363s-196-53-288 37c0 0 260-23 350 123l276 47c32 0 103-27 168-50 65-20 110-22 110-22s44 0 110 22 136 50 168 50c33 0 275-47 275-47 90-146 350-123 350-123-92-92-288-38-288-38"/></svg>`,
};
