/* Table Notes — Supabase-connected version.
   Recipe data is shared in Supabase. Shopping selections remain local to each browser. */

const SUPABASE_URL = "https://trzmieariwxdeyovdsea.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WRasDCTx0Utcd2Fz4yrRRA_Hqp5FR5R";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const AISLES = [
  ["fruit-veg","Fruit & vegetables"],["bakery","Pastry, bread & chocolate"],
  ["meat","Meat & fish"],["pasta","Pasta, rice & grains"],
  ["drinks","Orange juice & drinks"],["dairy","Cheeses & dairy"],
  ["canned","Canned food & jars"],["soup","Soup bags & seasonings"],
  ["frozen","Frozen"],["household","Other"]
];
const aisleLabel = Object.fromEntries(AISLES);

const rawRecipes = [
 ['lemon-pasta','Lemony kale pasta','healthy','#4d7a5a','25 min',2,'Silky pasta with greens, lemon and a salty crumble.','assets/recipe-images/lemony-kale-pasta.png',[['Pasta',250,'g','pasta'],['Kale',1,'bunch','fruit-veg'],['Lemon',1,'pc','fruit-veg'],['Parmesan',60,'g','dairy'],['Garlic',2,'cloves','fruit-veg'],['Olive oil',2,'tbsp','canned']]],
 ['miso-salmon','Miso salmon bowls','healthy','#4d7a5a','35 min',2,'Caramelized salmon, rice and crisp, bright veg.','assets/recipe-images/miso-salmon-bowl.png',[['Salmon fillets',2,'pc','meat'],['Miso paste',2,'tbsp','soup'],['Rice',180,'g','pasta'],['Cucumber',1,'pc','fruit-veg'],['Avocado',1,'pc','fruit-veg'],['Edamame',200,'g','frozen'],['Sesame seeds',1,'tbsp','soup']]],
 ['tacos','Friday tacos','comfort','#c16951','30 min',4,'The loud, messy, everyone-at-the-table kind.','',[['Tortillas',8,'pc','bakery'],['Ground beef',500,'g','meat'],['Taco seasoning',1,'bag','soup'],['Cheddar',150,'g','dairy'],['Lettuce',1,'head','fruit-veg'],['Tomatoes',3,'pc','fruit-veg'],['Sour cream',200,'g','dairy']]],
 ['chickpeas','Crispy chickpea salad','quick','#996b25','20 min',2,'Crunchy, creamy and ready before you are hungry.','',[['Chickpeas',2,'cans','canned'],['Mixed greens',150,'g','fruit-veg'],['Cucumber',1,'pc','fruit-veg'],['Cherry tomatoes',250,'g','fruit-veg'],['Feta',100,'g','dairy'],['Tahini',2,'tbsp','canned'],['Lemon',1,'pc','fruit-veg']]],
 ['pizza','Sunday pizza','unhealthy','#9e5366','45 min',2,'Slow Sunday dough, bubbly cheese, no apologies.','',[['Pizza dough',1,'pc','bakery'],['Tomato sauce',200,'ml','canned'],['Mozzarella',200,'g','dairy'],['Basil',1,'bunch','fruit-veg'],['Mushrooms',250,'g','fruit-veg']]],
 ['curry','Golden lentil curry','vegetarian','#7563a8','40 min',4,'A warmly spiced pot with soft sweet potato.','',[['Red lentils',250,'g','pasta'],['Sweet potato',1,'pc','fruit-veg'],['Coconut milk',400,'ml','canned'],['Curry paste',2,'tbsp','soup'],['Spinach',200,'g','fruit-veg'],['Lime',1,'pc','fruit-veg'],['Cilantro',1,'bunch','fruit-veg']]]
];

const normalize = r => ({
  ...r,
  servings: Math.max(1, Number(r.servings) || 2),
  ingredients: (r.ingredients || []).map(i => Array.isArray(i)
    ? {name:i[0],amount:Number(i[1])||0,unit:i[2]||"",aisle:i[3]||"household"}
    : {...i,amount:Number(i.amount)||0,aisle:i.aisle||"household"})
});
const starterRecipes = rawRecipes.map(([id,name,tag,tagColor,time,servings,description,image,ingredients]) =>
  normalize({id,name,tag,tagColor,time,servings,description,image,ingredients})
);

const LOCAL_RECIPES_KEY = "table-notes-recipes-v2";
const LOCAL_SELECTED_KEY = "table-notes-selected-v2";
const $ = selector => document.querySelector(selector);
const esc = (value = "") => {
  const el = document.createElement("div");
  el.textContent = String(value);
  return el.innerHTML;
};
const fmt = n => Number.isInteger(n) ? n : Number(n.toFixed(2));

let recipes = [];
let selected = new Map(JSON.parse(localStorage.getItem(LOCAL_SELECTED_KEY) || "[]"));
let activeTag = "all";
let checked = new Set();
let currentSession = null;
let realtimeChannel = null;
let isLoading = false;

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function persistSelection() {
  localStorage.setItem(LOCAL_SELECTED_KEY, JSON.stringify([...selected]));
}
function isSignedIn() {
  return Boolean(currentSession?.user);
}
function setAccountUI() {
  const signedIn = isSignedIn();
  $("#loginButton").hidden = signedIn;
  $("#logoutButton").hidden = !signedIn;
  $("#openRecipeDialog").hidden = !signedIn;
  const status = $("#accountStatus");
  status.innerHTML = signedIn
    ? `<i></i> signed in: ${esc(currentSession.user.email || "account")}`
    : "<i></i> public recipe view";
}
function toDbRow(recipe) {
  const r = normalize(recipe);
  return {
    id: String(r.id),
    name: r.name,
    tag: r.tag || "",
    tag_color: r.tagColor || "#526d56",
    time: r.time || "",
    servings: r.servings,
    description: r.description || "",
    image: r.image || "",
    ingredients: r.ingredients,
    updated_at: new Date().toISOString()
  };
}
function fromDbRow(row) {
  return normalize({
    id: row.id, name: row.name, tag: row.tag, tagColor: row.tag_color,
    time: row.time, servings: row.servings, description: row.description,
    image: row.image, ingredients: row.ingredients
  });
}
function readLocalRecipes() {
  try {
    const raw = localStorage.getItem(LOCAL_RECIPES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map(normalize) : null;
  } catch (error) {
    console.error("Could not read local recipe backup:", error);
    return null;
  }
}
async function fetchRecipes({seedIfEmpty = true} = {}) {
  isLoading = true;
  try {
    const {data, error} = await supabaseClient
      .from("recipes")
      .select("*")
      .order("name", {ascending:true});
    if (error) throw error;

    if ((!data || data.length === 0) && seedIfEmpty && isSignedIn()) {
      // On the first signed-in visit, preserve this browser's saved recipes.
      // If there is no local collection, populate the shared table with the starter recipes.
      const local = readLocalRecipes();
      const initial = local || starterRecipes;
      const {error: seedError} = await supabaseClient
        .from("recipes")
        .upsert(initial.map(toDbRow), {onConflict:"id"});
      if (seedError) throw seedError;
      const {data: seeded, error: reloadError} = await supabaseClient
        .from("recipes").select("*").order("name", {ascending:true});
      if (reloadError) throw reloadError;
      recipes = (seeded || []).map(fromDbRow);
      if (local) toast("Your saved recipes have been imported to the shared collection.");
      else toast("Starter recipes added to the shared collection.");
    } else {
      recipes = (data || []).map(fromDbRow);
    }
    render();
  } catch (error) {
    console.error("Recipe loading failed:", error);
    toast(`Couldn't load shared recipes: ${error.message || error}`);
  } finally {
    isLoading = false;
  }
}
async function saveRecipe(recipe) {
  if (!isSignedIn()) {
    toast("Sign in to add or edit recipes.");
    return false;
  }
  const {data, error} = await supabaseClient
    .from("recipes")
    .upsert(toDbRow(recipe), {onConflict:"id"})
    .select()
    .single();
  if (error) {
    console.error("Recipe save failed:", error);
    toast(`Couldn't save recipe: ${error.message}`);
    return false;
  }
  const saved = fromDbRow(data);
  const index = recipes.findIndex(r => r.id === saved.id);
  if (index < 0) recipes.unshift(saved);
  else recipes[index] = saved;
  render();
  toast(`${saved.name} saved to the shared collection.`);
  return true;
}
async function deleteRecipe(id) {
  if (!isSignedIn()) return toast("Sign in to delete recipes.");
  const recipe = recipes.find(r => r.id === id);
  if (!recipe || !confirm(`Delete “${recipe.name}” from the shared collection?`)) return;
  const {error} = await supabaseClient.from("recipes").delete().eq("id", id);
  if (error) {
    console.error("Recipe delete failed:", error);
    toast(`Couldn't delete recipe: ${error.message}`);
    return;
  }
  recipes = recipes.filter(r => r.id !== id);
  selected.delete(id);
  persistSelection();
  render();
  toast("Recipe deleted from the shared collection.");
}
function tags() {
  return ["all", ...new Set(recipes.map(r => (r.tag || "").toLowerCase()).filter(Boolean))];
}
function tagData(tag) {
  return recipes.find(r => (r.tag || "").toLowerCase() === tag) || {tag,tagColor:"#526d56"};
}
function renderFilters() {
  $("#tagFilters").innerHTML = tags().map(tag => {
    const data = tagData(tag);
    return `<button class="filter ${activeTag === tag ? "active" : ""}" data-tag="${esc(tag)}" style="--tag-color:${esc(data.tagColor)}">${tag === "all" ? "all recipes" : esc(data.tag)}</button>`;
  }).join("");
}
function renderRecipes() {
  const shown = recipes.filter(r => activeTag === "all" || (r.tag || "").toLowerCase() === activeTag);
  $("#recipeGrid").innerHTML = shown.map(r => {
    const qty = selected.get(r.id) || r.servings;
    const imageStyle = r.image ? `style="--recipe-image:url('${esc(r.image)}')"` : "";
    const editButton = isSignedIn()
      ? `<button class="card-edit" data-edit="${esc(r.id)}" aria-label="Edit ${esc(r.name)}">✎</button>` : "";
    return `<article class="recipe-card ${selected.has(r.id) ? "selected" : ""} ${r.image ? "has-image" : ""}" data-id="${esc(r.id)}" tabindex="0" ${imageStyle}>
      <div class="card-content">
        <span class="tag" style="--tag-color:${esc(r.tagColor)}">${esc(r.tag)}</span>
        ${editButton}
        <h3>${esc(r.name)}</h3>
        <p>${esc(r.description || "A recipe worth keeping close.")}</p>
        <div class="card-footer"><span>${esc(r.time || "—")}</span>
          <label class="serves"><span>serves</span><input type="number" min="1" value="${qty}" data-serves="${esc(r.id)}"></label>
        </div>
      </div>
    </article>`;
  }).join("");
  $("#emptyRecipes").hidden = shown.length !== 0;
  $("#selectedCount").textContent = selected.size;
}
function groceries() {
  const combined = new Map();
  for (const [id, eaters] of selected) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) continue;
    for (const ingredient of recipe.ingredients) {
      const key = `${ingredient.name.toLowerCase()}|${ingredient.unit}|${ingredient.aisle}`;
      const old = combined.get(key) || {...ingredient,amount:0};
      old.amount += ingredient.amount * eaters / recipe.servings;
      combined.set(key, old);
    }
  }
  return [...combined.values()].sort((a,b) =>
    AISLES.findIndex(x => x[0] === a.aisle) - AISLES.findIndex(x => x[0] === b.aisle) ||
    a.name.localeCompare(b.name)
  );
}
function renderGrocery() {
  const items = groceries();
  $("#groceryHint").textContent = items.length
    ? `${items.length} ingredient${items.length === 1 ? "" : "s"} for ${selected.size} recipe${selected.size === 1 ? "" : "s"}, ordered for Lidl.`
    : "Select recipes above to start your list.";
  let last = "";
  $("#groceryItems").innerHTML = items.length ? items.map(item => {
    const key = `${item.name}|${item.unit}|${item.aisle}`;
    const heading = last !== item.aisle
      ? (last = item.aisle, `<div class="aisle-heading">${esc(aisleLabel[item.aisle] || "Other")}</div>`)
      : "";
    return `${heading}<label class="grocery-item ${checked.has(key) ? "checked" : ""}">
      <input type="checkbox" data-item="${esc(key)}" ${checked.has(key) ? "checked" : ""}>
      <span>${esc(item.name)}</span><strong>${fmt(item.amount)} ${esc(item.unit)}</strong>
    </label>`;
  }).join("") : '<p class="grocery-placeholder">Your grocery list will appear here. Pick as many recipes as you like.</p>';
  $("#copyList").disabled = !items.length;
  $("#clearChecked").disabled = !checked.size;
}
function render() {
  renderFilters();
  renderRecipes();
  renderGrocery();
}
function ingredientText(items) {
  return items.map(i => `${i.name} | ${i.amount} | ${i.unit} | ${i.aisle}`).join("\n");
}
function parseIngredients(text) {
  return text.split("\n").filter(Boolean).map((line,index) => {
    const [name,amount,unit,aisle] = line.split("|").map(value => value?.trim());
    if (!name || !amount || Number.isNaN(Number(amount))) {
      throw new Error(`Check ingredient line ${index + 1}: name | quantity | unit | Lidl section.`);
    }
    return {
      name, amount:Number(amount), unit:unit || "pc",
      aisle:AISLES.some(a => a[0] === aisle) ? aisle : "household"
    };
  });
}
function openEditor(recipe) {
  if (!isSignedIn()) return toast("Sign in to manage recipes.");
  const form = $("#recipeForm");
  form.reset();
  const values = {
    id:recipe?.id || "", name:recipe?.name || "", tag:recipe?.tag || "",
    tagColor:recipe?.tagColor || "#526d56", time:recipe?.time || "",
    servings:recipe?.servings || 2, description:recipe?.description || "",
    image:recipe?.image || "", ingredients:recipe ? ingredientText(recipe.ingredients) : ""
  };
  for (const [key,value] of Object.entries(values)) form.elements[key].value = value;
  $("#dialogHeading").textContent = recipe ? "Edit recipe" : "Add a recipe";
  $("#dialogEyebrow").textContent = recipe ? "MAKE IT YOURS" : "A NEW FAVOURITE";
  $("#deleteRecipe").hidden = !recipe;
  $("#recipeDialog").showModal();
}

$("#loginButton").addEventListener("click", () => {
  $("#loginMessage").textContent = "Only invited accounts can sign in and edit recipes.";
  $("#authDialog").showModal();
});
$("#logoutButton").addEventListener("click", async () => {
  const {error} = await supabaseClient.auth.signOut();
  if (error) return toast(error.message);
  currentSession = null;
  setAccountUI();
  render();
  toast("Signed out. You can still browse recipes.");
});
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("#sendLoginLink");
  const email = new FormData(event.currentTarget).get("email").trim();
  button.disabled = true;
  $("#loginMessage").textContent = "Sending your secure sign-in link…";
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const {error} = await supabaseClient.auth.signInWithOtp({
    email,
    options: {emailRedirectTo:redirectTo, shouldCreateUser:false}
  });
  button.disabled = false;
  $("#loginMessage").textContent = error
    ? `Couldn't send the link: ${error.message}`
    : "Check your inbox for your sign-in link. You can close this window.";
  if (!error) toast("Sign-in link sent.");
});
$("#openRecipeDialog").addEventListener("click", () => openEditor());
$("#recipeForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isSignedIn()) return toast("Please sign in first.");
  const form = new FormData(event.currentTarget);
  try {
    const name = String(form.get("name") || "").trim();
    const recipe = normalize({
      id:form.get("id") || `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g,"-")}`,
      name, tag:String(form.get("tag") || "").trim(),
      tagColor:form.get("tagColor"), time:String(form.get("time") || "").trim() || "—",
      servings:form.get("servings"), description:String(form.get("description") || "").trim(),
      image:String(form.get("image") || "").trim(), ingredients:parseIngredients(form.get("ingredients"))
    });
    if (await saveRecipe(recipe)) $("#recipeDialog").close();
  } catch (error) {
    toast(error.message);
  }
});
$("#deleteRecipe").addEventListener("click", async () => {
  const id = $("#recipeForm").elements.id.value;
  await deleteRecipe(id);
  if (!recipes.some(r => r.id === id)) $("#recipeDialog").close();
});
$("#tagFilters").addEventListener("click", event => {
  const button = event.target.closest("[data-tag]");
  if (button) { activeTag = button.dataset.tag; render(); }
});
$("#recipeGrid").addEventListener("click", event => {
  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    event.stopPropagation();
    return openEditor(recipes.find(r => r.id === editButton.dataset.edit));
  }
  if (event.target.closest("[data-serves]")) return;
  const card = event.target.closest(".recipe-card");
  if (card) {
    const recipe = recipes.find(r => r.id === card.dataset.id);
    if (!recipe) return;
    selected.has(recipe.id) ? selected.delete(recipe.id) : selected.set(recipe.id, recipe.servings);
    persistSelection();
    render();
  }
});
$("#recipeGrid").addEventListener("change", event => {
  const input = event.target.closest("[data-serves]");
  if (!input) return;
  selected.set(input.dataset.serves, Math.max(1, Number(input.value) || 1));
  persistSelection();
  renderGrocery();
});
$("#recipeGrid").addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && !event.target.matches("input,button")) {
    event.preventDefault();
    const recipe = recipes.find(r => r.id === event.target.dataset.id);
    if (!recipe) return;
    selected.has(recipe.id) ? selected.delete(recipe.id) : selected.set(recipe.id, recipe.servings);
    persistSelection();
    render();
  }
});
$("#groceryItems").addEventListener("change", event => {
  if (!event.target.dataset.item) return;
  event.target.checked ? checked.add(event.target.dataset.item) : checked.delete(event.target.dataset.item);
  renderGrocery();
});
$("#clearSelection").addEventListener("click", () => {
  selected.clear(); checked.clear(); persistSelection(); render();
});
$("#clearChecked").addEventListener("click", () => { checked.clear(); renderGrocery(); });
$("#randomRecipe").addEventListener("click", () => {
  if (!recipes.length) return toast("No recipes are available yet.");
  const recipe = recipes[Math.floor(Math.random() * recipes.length)];
  selected.set(recipe.id, recipe.servings);
  persistSelection(); render();
  document.querySelector(`[data-id="${CSS.escape(recipe.id)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});
  toast(`${recipe.name} is on the menu.`);
});
$("#copyList").addEventListener("click", async () => {
  const text = groceries().map(item =>
    `${aisleLabel[item.aisle] || "Other"}\n• ${item.name} — ${fmt(item.amount)} ${item.unit}`
  ).join("\n").replace(/([^\n])\n([^•])/g,"$1\n\n$2");
  try { await navigator.clipboard.writeText(text); toast("Grocery list copied."); }
  catch { toast("Copy unavailable — select the list to copy it."); }
});

function startRealtime() {
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
  realtimeChannel = supabaseClient
    .channel("public-recipes-changes")
    .on("postgres_changes", {event:"*",schema:"public",table:"recipes"}, () => {
      fetchRecipes({seedIfEmpty:false});
    })
    .subscribe(status => {
      if (status === "CHANNEL_ERROR") console.warn("Realtime subscription failed. Refresh the page to load the latest recipes.");
    });
}
async function handleSession(session) {
  currentSession = session;
  setAccountUI();
  await fetchRecipes({seedIfEmpty:true});
  startRealtime();
}

async function init() {
  if (!window.supabase?.createClient) {
    toast("Supabase library did not load. Check your internet connection.");
    return;
  }
  const {data:{session}, error} = await supabaseClient.auth.getSession();
  if (error) console.error("Could not read sign-in session:", error);
  currentSession = session;
  setAccountUI();
  await fetchRecipes({seedIfEmpty:true});

  supabaseClient.auth.onAuthStateChange((_event, sessionNow) => {
    // Defer follow-up work so the auth callback does not block Supabase's internal event handling.
    Promise.resolve().then(() => handleSession(sessionNow));
  });
}
init();
