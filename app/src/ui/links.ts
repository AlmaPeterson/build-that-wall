// The card game's store page.
export const AMAZON_URL = 'https://www.amazon.com/Beacon-Political-Outrageously-Adults-Players/dp/B0DPCY51PJ';

/** The store link, with the owner's Amazon tag from game-settings.json when there is one. */
export const amazonUrl = (tag: string): string => (tag ? AMAZON_URL + '?tag=' + encodeURIComponent(tag) : AMAZON_URL);
