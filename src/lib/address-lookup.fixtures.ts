/** Addresses at one Hixon postcode, for the tests. */

import { fromIdeal, type FoundAddress } from "./address-lookup";

/** As Ideal Postcodes returns them: post town in capitals, the village on line 2. */
export const RAW = [
  { line_1: "12 Smithy Lane", line_2: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "12", thoroughfare: "Smithy Lane" },
  { line_1: "14 Smithy Lane", line_2: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "14", thoroughfare: "Smithy Lane" },
  { line_1: "Flat 1", line_2: "16 Smithy Lane", line_3: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "16", sub_building_name: "Flat 1", thoroughfare: "Smithy Lane" },
  { line_1: "Flat 2", line_2: "16 Smithy Lane", line_3: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "16", sub_building_name: "Flat 2", thoroughfare: "Smithy Lane" },
  { line_1: "Rose Cottage", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_name: "Rose Cottage", thoroughfare: "Smithy Lane" },
  { line_1: "2a Church Road", line_2: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "2a", thoroughfare: "Church Road" },
  { line_1: "14 Church Road", line_2: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PQ", building_number: "14", thoroughfare: "Church Road" },
];
export const ADDRESSES: FoundAddress[] = RAW.map(fromIdeal);

/** A lane of named houses, as Ideal Postcodes returns them. */
export const NAMED_RAW = [
  { line_1: "The Old Forge", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "The Old Forge", thoroughfare: "Smithy Lane" },
  { line_1: "The Hollies", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "The Hollies", thoroughfare: "Smithy Lane" },
  { line_1: "Ivy House", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Ivy House", thoroughfare: "Smithy Lane" },
  { line_1: "Ivy Cottage", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Ivy Cottage", thoroughfare: "Smithy Lane" },
  { line_1: "Woodlands", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Woodlands", thoroughfare: "Smithy Lane" },
  { line_1: "Rose Cottage", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Rose Cottage", thoroughfare: "Smithy Lane" },
  { line_1: "Rose Villa", line_2: "Smithy Lane, Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Rose Villa", thoroughfare: "Smithy Lane" },
  { line_1: "Meadow View, 7 Smithy Lane", line_2: "Hixon", post_town: "STAFFORD", postcode: "ST18 0PR", building_name: "Meadow View", building_number: "7", thoroughfare: "Smithy Lane" },
];
export const NAMED: FoundAddress[] = NAMED_RAW.map(fromIdeal);
