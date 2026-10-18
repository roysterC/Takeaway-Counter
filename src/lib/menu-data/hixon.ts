/**
 * Hixon Chinese's printed menu, as seed data. Transcribed from the shop's
 * two-page leaflet; edit the live menu in the CRM (Menu), not here. This file
 * only fills an empty menu.
 *
 * Each item: [code, name, price in pounds, description?]. Where the leaflet
 * offers a choice inside one number ("Crispy Shredded Chicken/Beef", the
 * quarter or half duck), each choice is its own item under the same number,
 * so the kitchen ticket says which was ordered.
 */

export type SeedItem = [code: string | null, name: string, pounds: number, description?: string];

export interface SeedCategory {
  name: string;
  note?: string;
  items: SeedItem[];
}

export const HIXON_MENU: SeedCategory[] = [
  {
    name: "Special Set Menus",
    note: "No alterations can be made to set menus.",
    items: [
      [
        "A",
        "Set Meal A for 2 Persons",
        28.5,
        "Spare Ribs in Peking Sauce, Spring Rolls, Crispy Shredded Beef in Hot Chilli Sauce, Sweet & Sour Pork Hong Kong Style, Chicken with Green Pepper in Black Bean Sauce, Egg Fried Rice",
      ],
      [
        "B",
        "Set Meal B for 2 Persons",
        32.5,
        "Pork Yuk Sung, Mini Veg Spring Rolls, Sweet & Sour Chicken Hong Kong Style, Beef with Green Pepper in Black Bean Sauce, King Prawn with Cashew Nuts, Yeung Chow Fried Rice",
      ],
      [
        "C",
        "Set Meal C for 3 Persons",
        42.5,
        "BBQ Spare Ribs, Chicken Satay Skewers, Szechuan King Prawn, Duck in Plum Sauce, Beef in Peking Sauce, Sweet & Sour Chicken Hong Kong Style, Egg Fried Rice",
      ],
      [
        "E",
        "Set Meal E for 4 Persons",
        58.5,
        "Sesame Prawn Toast, Spring Rolls, BBQ Spare Ribs, Sweet & Sour Pork Hong Kong Style, Chicken in Thai Sauce, Duck in Plum Sauce, King Prawn with Ginger & Spring Onions, Beef with Green Pepper in Black Bean Sauce, Yeung Chow Fried Rice",
      ],
    ],
  },
  {
    name: "Appetisers",
    items: [
      ["1", "Spare Ribs with Salt Chilli & Pepper", 7.0],
      ["2", "Spare Ribs with Peking Sauce", 7.0],
      ["3", "Spare Ribs Aromatic with Lemon", 7.0],
      ["4", "Spare Ribs with Syrup", 7.0],
      ["5", "Spare Ribs with BBQ Sauce", 7.0],
      ["6", "Spare Ribs with Sweet & Sour Sauce", 7.0],
      ["7", "Chicken Wings with Salt Chilli & Pepper", 6.5],
      ["8", "Chicken Wings with Syrup", 6.5],
      ["9", "Chicken Wings Plain", 6.5],
      ["10", "Chicken Wings with Peking Sauce", 6.5],
      ["11", "Spring Rolls (2)", 4.0],
      ["12", "Mini Vegetarian Spring Rolls (10)", 4.2],
      ["13", "Deep Fried Won Ton with Sweet & Sour Sauce (8)", 5.0],
      ["14", "Sesame Prawn Toast (6)", 4.5],
      ["15", "Butterfly King Prawn", 6.8, "Deep fried king prawns coated in breadcrumbs"],
      ["16", "Chicken Satay on Skewers (4)", 6.5, "Contains peanuts"],
      ["17", "Vegetarian Yuk Sung", 6.5],
      [
        "18",
        "Pork Yuk Sung",
        7.0,
        "A mixture of finely chopped meat & crunchy vegetable served with lettuce & crispy rice noodle",
      ],
      [
        "22",
        "Crispy Aromatic Duck (Quarter)",
        10.0,
        "Crispy shredded duck cooked with aromatic spices, served with pancakes, cucumber, spring onion & hoi sin sauce",
      ],
      [
        "22",
        "Crispy Aromatic Duck (Half)",
        18.5,
        "Crispy shredded duck cooked with aromatic spices, served with pancakes, cucumber, spring onion & hoi sin sauce",
      ],
      [
        "23",
        "Special Mixed Appetisers for Two",
        9.0,
        "Spring rolls, prawn toast, chicken wings, spare ribs with sweet & sour dip",
      ],
    ],
  },
  {
    name: "Soup",
    items: [
      ["25", "Chicken & Sweet Corn Soup", 4.6],
      ["27", "Hot & Sour Soup", 4.6],
      ["29", "Chicken & Mushroom Soup", 4.6],
      ["30", "Chicken & Noodle Soup", 4.6],
      ["31", "Vegetable Soup", 4.3],
    ],
  },
  {
    name: "Chicken Dishes",
    items: [
      ["33", "Lemon Chicken", 6.9],
      ["34", "Chicken with Cashew Nuts", 6.9],
      ["35", "Chicken with Pineapple", 6.9],
      ["36", "Chicken with Mushroom", 6.9],
      ["37", "Chicken with Water Chestnuts & Bamboo Shoots", 6.9],
      ["38", "Kung Po Chicken", 6.9],
      ["39", "Chicken with Green Pepper in Black Bean Sauce", 6.9],
      ["39a", "Chicken with Mushroom in Black Bean Sauce", 6.9],
      ["40", "Chicken with Ginger & Spring Onions", 6.9],
      ["41", "Chicken with Vegetable in Oyster Sauce", 6.9],
      ["43", "Chicken in Thai Sauce", 6.9],
      ["44", "Szechuan Chicken", 6.9],
      ["46", "Chicken Chop Suey", 6.9],
      ["46a", "Chicken with Beansprout", 6.9],
      ["46b", "Chicken with Fresh Tomato", 6.9],
      ["46c", "Chicken in Peking Sauce", 6.9],
    ],
  },
  {
    name: "Beef Dishes",
    items: [
      ["48", "Beef with Mushroom", 7.0],
      ["49", "Beef with Green Pepper in Black Bean Sauce", 7.0],
      ["49a", "Beef with Mushroom in Black Bean Sauce", 7.0],
      ["50", "Beef with Ginger & Spring Onions", 7.0],
      ["51", "Beef with Vegetable in Oyster Sauce", 7.0],
      ["52", "Beef in Thai Sauce", 7.0],
      ["53", "Szechuan Beef", 7.0],
      ["55", "Beef with Fresh Tomato", 7.0],
      ["56", "Beef Chop Suey", 7.0],
      ["56a", "Beef in Peking Sauce", 7.0],
      ["56b", "Kung Po Beef", 7.0],
    ],
  },
  {
    name: "Beef Fillet Steak Dishes",
    items: [
      ["57", "Fillet Steak Cantonese Style", 11.0],
      ["58", "Fillet Steak with Green Pepper in Black Bean Sauce", 11.0],
      ["59", "Fillet Steak in Black Pepper Sauce", 11.0],
      ["60", "Fillet Steak with Ginger & Spring Onion", 11.0],
      ["62", "Fillet Steak with Vegetable in Oyster Sauce", 11.0],
      ["63", "Fillet Steak with Vegetable in Satay Sauce", 11.0, "Contains peanuts"],
      ["63a", "Szechuan Fillet Steak", 11.0],
    ],
  },
  {
    name: "Roast Pork / Char Siu Dishes",
    note: "Roast pork is char siu.",
    items: [
      ["64", "Roast Pork with Mushroom", 6.9],
      ["65", "Roast Pork with Green Pepper in Black Bean Sauce", 6.9],
      ["65a", "Roast Pork with Mushroom in Black Bean Sauce", 6.9],
      ["66", "Roast Pork with Ginger & Spring Onions", 6.9],
      ["67", "Roast Pork with Chinese Leaves", 6.9],
      ["68", "Szechuan Roast Pork", 6.9],
      ["70", "Roast Pork with Beansprout", 6.9],
      ["71", "Roast Pork Double Cooked", 6.9],
      ["72", "Roast Pork Chop Suey", 6.9],
    ],
  },
  {
    name: "Roast Duck Dishes",
    items: [
      ["73", "Special Roast Duck", 8.0],
      ["74", "Roast Duck in Plum Sauce", 8.0],
      ["75", "Roast Duck in Orange Sauce", 8.0],
      ["76", "Roast Duck with Pineapple", 8.0],
      ["77", "Roast Duck with Mushroom", 8.0],
      ["78", "Roast Duck with Green Pepper in Black Bean Sauce", 8.0],
      ["79", "Szechuan Roast Duck", 8.0],
      ["80a", "Roast Duck with BBQ Sauce", 8.0],
      ["80b", "Roast Duck in Peking Sauce", 8.0],
    ],
  },
  {
    name: "King Prawn Dishes",
    items: [
      ["81", "King Prawn with Salt Chilli & Pepper", 7.6],
      ["82", "King Prawn with Cashew Nuts", 7.6],
      ["83", "King Prawn with Mushroom", 7.6],
      ["84", "King Prawn with Green Pepper in Black Bean Sauce", 7.6],
      ["84a", "King Prawn with Mushroom in Black Bean Sauce", 7.6],
      ["85", "King Prawn with Ginger & Spring Onions", 7.6],
      ["86", "King Prawn with Vegetable in Oyster Sauce", 7.6],
      ["87", "King Prawn in Thai Sauce", 7.6],
      ["88", "Szechuan King Prawn", 7.6],
      ["88a", "Kung Po King Prawn", 7.6],
      ["88b", "King Prawn Chop Suey", 7.6],
    ],
  },
  {
    name: "Crispy Shredded Dishes",
    items: [
      ["89", "Crispy Shredded Chicken in Hot Chilli Sauce", 7.0],
      ["89", "Crispy Shredded Beef in Hot Chilli Sauce", 7.0],
      ["90", "Crispy Shredded Chicken with Salt Chilli & Pepper", 7.0],
      ["90", "Crispy Shredded Beef with Salt Chilli & Pepper", 7.0],
      ["91", "Crispy Shredded Chicken in Peking Sauce", 7.0],
      ["91", "Crispy Shredded Beef in Peking Sauce", 7.0],
      ["92", "Crispy Shredded Chicken in Thai Sauce", 7.0],
      ["92", "Crispy Shredded Beef in Thai Sauce", 7.0],
      ["93", "Crispy Squid with Salt Chilli & Pepper", 7.3],
      ["93a", "Crispy Chicken (Pieces) with Salt Chilli & Pepper", 7.0],
    ],
  },
  {
    name: "Sweet & Sour Dishes",
    items: [
      ["94", "Sweet & Sour Chicken Hong Kong Style", 7.0],
      ["95", "Sweet & Sour Pork Hong Kong Style", 7.0],
      ["96", "Sweet & Sour King Prawn Hong Kong Style", 7.7],
      ["97", "Sweet & Sour Vegetable", 6.0],
      ["98", "Chicken Balls with Sweet & Sour Sauce", 7.0],
      ["99", "King Prawn Balls with Sweet & Sour Sauce", 7.7],
    ],
  },
  {
    name: "Satay Dishes",
    note: "All satay dishes contain peanuts.",
    items: [
      ["100", "Chicken with Vegetable in Satay Sauce", 6.9],
      ["101", "Beef with Vegetable in Satay Sauce", 7.0],
      ["102", "King Prawn with Vegetable in Satay Sauce", 7.6],
      ["102a", "Duck with Vegetable in Satay Sauce", 8.0],
      ["102b", "Mixed Vegetable in Satay Sauce", 6.0],
      ["103", "Chicken Satay on Skewers", 6.5],
    ],
  },
  {
    name: "Curry Dishes",
    note: "Served in a large container. Mushroom can be added to any curry for 80p extra (item X1).",
    items: [
      ["106", "Special Curry", 6.5],
      ["107", "Beef Curry", 6.1],
      ["108", "Chicken Curry", 6.0],
      ["109", "Shrimp Curry", 6.0],
      ["110", "Pork Curry", 6.0],
      ["111", "Duck Curry", 7.0],
      ["112", "King Prawn Curry", 6.7],
      ["113", "Mushroom Curry", 5.7],
      ["114", "Mixed Vegetable Curry", 5.7],
    ],
  },
  {
    name: "Vegetarian Dishes",
    items: [
      [
        "122",
        "Stir Fried Beancurd with Mixed Vegetable",
        6.5,
        "Beancurd is tofu, made from soya: high in nutrition and a good source of protein",
      ],
      ["122a", "Stir Fried Beancurd in Black Bean Sauce", 6.5],
      ["122b", "Deep Fried Beancurd with Salt Chilli & Pepper", 6.5],
      ["123", "Stir Fried Bamboo Shoots & Water Chestnuts", 6.0],
      ["124", "Stir Fried Say So", 6.0, "Four veg: Chinese leaves, mushroom, water chestnuts, carrots"],
      ["125", "Stir Fried Mixed Vegetable", 6.0],
      ["125a", "Stir Fried Mixed Vegetable in Black Bean Sauce", 6.0],
      ["125b", "Stir Fried Mixed Vegetable in Szechuan Sauce", 6.0],
      ["126", "Stir Fried Beansprout", 4.5],
      ["127", "Stir Fried Mushroom", 5.7],
      ["127a", "Stir Fried Mushroom in Black Bean Sauce", 5.7],
    ],
  },
  {
    name: "Omelette Dishes",
    note: "Omelettes include chips.",
    items: [
      ["129", "King Prawn Omelette", 8.0],
      ["130", "Chicken Omelette", 7.3],
      ["131", "Pork Omelette", 7.3],
      ["133", "Mushroom Omelette", 7.0],
      ["134", "Plain Omelette with Onions", 6.4],
    ],
  },
  {
    name: "Foo Yung Dishes",
    note: "Foo yung is scrambled egg.",
    items: [
      ["135", "King Prawn Foo Yung", 7.6],
      ["136", "Special Foo Yung", 7.1],
      ["137", "Chicken Foo Yung", 6.9],
      ["138", "Pork Foo Yung", 6.9],
      ["139", "Mushroom Foo Yung", 6.0],
    ],
  },
  {
    name: "House Special Chow Mein Dishes",
    note: "Comes in 2 separate containers: chow mein in one, meat & veg with sauce in the other.",
    items: [
      ["141", "House Special Chow Mein", 9.0, "Chicken, beef, pork & king prawn"],
      ["142", "House Special King Prawn Chow Mein", 9.0],
      ["143", "House Special Chicken Chow Mein", 8.3],
      ["144", "House Special Beef Chow Mein", 8.3],
      ["145", "House Special Roast Pork Chow Mein", 8.3],
    ],
  },
  {
    name: "Chow Mein Dishes",
    note: "Soft noodles, served in a large container.",
    items: [
      ["146", "King Prawn Chow Mein", 7.6],
      ["147", "Chicken Chow Mein", 6.9],
      ["148", "Beef Chow Mein", 7.0],
      ["149", "Roast Pork Chow Mein", 6.9],
      ["150", "Shrimp Chow Mein", 6.9],
      ["150a", "Roast Duck Chow Mein", 8.0],
      ["151", "Mixed Vegetable Chow Mein", 6.5],
      ["152", "Mushroom Chow Mein", 6.5],
      ["153", "Plain Chow Mein with Beansprout", 5.5],
      ["154", "Singapore Chow Mein", 7.2],
      ["155", "Vegetable Singapore Chow Mein", 6.6],
      ["156", "Singapore Vermicelli", 7.2],
      ["157", "Vegetable Singapore Vermicelli", 6.6],
    ],
  },
  {
    name: "Fried Rice Dishes",
    note: "Fried rice dishes come in a large container, except sweetcorn fried rice, egg fried rice and boiled rice, which come in a small one.",
    items: [
      [
        "158",
        "House Special Fried Rice",
        9.0,
        "Comes in 2 containers: fried rice in one, mixed meat, king prawn & mixed veg with sauce in the other",
      ],
      ["159", "King Prawn Fried Rice", 7.6],
      ["160", "Singapore Fried Rice", 7.2],
      ["161", "Chicken & Pineapple Fried Rice", 7.0],
      ["162", "Yeung Chow Fried Rice", 7.0, "Chicken, pork & shrimp"],
      ["163", "Chicken Fried Rice", 6.9],
      ["164", "Roast Pork Fried Rice", 6.9],
      ["165", "Shrimp Fried Rice", 6.9],
      ["166", "Beef Fried Rice", 6.9],
      ["166a", "Roast Duck Fried Rice", 8.0],
      ["167", "Mushroom Fried Rice", 6.5],
      ["168", "Mixed Vegetable Fried Rice", 6.5],
      ["169", "Sweetcorn Fried Rice", 3.5],
      ["170", "Egg Fried Rice", 3.3],
      ["171", "Boiled Rice", 3.0],
    ],
  },
  {
    name: "Extra Portions",
    items: [
      [null, "3 in 1 Special", 5.3, "Chips, fried rice & curry sauce"],
      [null, "Salt Chilli Pepper Chips", 4.9],
      ["172", "Chips", 3.0],
      ["173", "Prawn Crackers", 3.0],
      ["174", "Curry Sauce", 2.9],
      ["175", "Sweet & Sour Sauce", 2.9],
      ["176", "BBQ Sauce", 2.9],
      ["177", "Thai Sauce", 3.1],
      ["178", "Plum Sauce", 3.1],
      ["179", "Satay Sauce", 3.1, "Contains peanuts"],
      ["180", "Hoi Sin Sauce", 3.3],
      ["183", "Peking Sauce", 3.1],
      ["X1", "Add Mushroom to Curry", 0.8, "Only with a curry dish"],
    ],
  },
];

/** What the receptionist knows about Hixon beyond the menu. Editable in Settings. */
export const HIXON_NOTES = `Address: 2A Smithy Lane, Hixon, Stafford, ST18 0PP. Phone 01889 270870. Website www.hixonchinese.co.uk.
Cantonese and Chinese cuisine to take away.
Cash only: no card payments, for collection or delivery. Drivers carry change.
Open on all bank holiday Mondays, 5pm to 9:30pm, even though Mondays are usually closed.
Dishes do not include rice or chips unless the menu says so (omelettes come with chips; set meals include their rice).
Sauces: oyster sauce is light and savoury; Peking sauce is sweet, fruity and tangy; Kung Po is sweet, spicy and savoury; Szechuan is hot and spicy; Thai sauce is sweet chilli with garlic.
Allergies: the shop cannot guarantee any dish is free from an allergen. Satay dishes contain peanuts and cashew dishes contain nuts. For any other allergy question, take a message so the staff can ring back before the order is made.`;
