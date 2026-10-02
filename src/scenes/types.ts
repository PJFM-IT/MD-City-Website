export type PeopleVariant =
  | "film"
  | "queue"
  | "giving"
  | "greeting"
  | "hall"
  | "worship"
  | "prayer"
  | "declare"
  | "land"
  | "portrait";

export type VenueVariant = "vision" | "zion" | "carmel" | "facility";

export type SceneName = "aerial" | "aerial-night" | VenueVariant | PeopleVariant;
