# Unfuel: product requirements

Status: built, first version · 2026-11-27. What differs from this document is listed in erd.md, section 23.
Companion: [erd.md](erd.md) (engineering requirements)

## 1. What it is

Unfuel is a web app, installable on a phone, that tells a rider what their vehicle really costs to run. It is a rebuild of the fuel-log core of [Fuelio](https://fuel.io/) with one change to how data gets in: **the rider takes two photos, the fuel bill and the odometer, and the app works out the rest.**

Fuelio asks you to add a vehicle, then type the odometer and fuel amount at every fill-up (receipt scanning is a paid extra). Unfuel turns that around. Photos first, typing only when a photo cannot be read.

## 2. Who it is for

Someone who rides or drives daily, refuels every week or two, and wants to know three things without keeping a notebook:

- What mileage am I actually getting?
- What does a kilometre cost me?
- Is the vehicle getting worse, and since when?

The first users are in India: bikes and scooters, rupees, kilometres, litres, and a habit of asking for "1,000 rupees of petrol" instead of a full tank. The product has to give that rider a useful number, not only the full-tank rider.

## 3. Principles

1. **Two photos, done.** Signing in and adding photos is the whole first session. No vehicle form, no settings, no tutorial before the first fill-up.
2. **Never lose a capture.** Pumps often have poor signal. A photo taken offline is kept on the phone and read automatically once there is a connection.
3. **Say how sure the number is.** An exact figure and an estimate look different on screen.
4. **Typing always works.** Every field the AI fills can be typed or corrected by hand.
5. **Phone first.** Every screen is designed at phone width and then widened for tablets and desktops. Nothing scrolls sideways.

## 4. Scope

### In version 1

- Sign in with Google
- Add a fill-up from photos (bill, pump display, odometer), read by AI
- Add or edit a fill-up by hand
- Works offline: captures and edits queue on the device and sync later
- Location saved with each fill-up; fuel stations recognised and compared
- Mileage, cost per km, spend, with exact and estimated figures
- Charts and insights, including a notice when mileage drops
- More than one vehicle
- One-tap hand-off of a fill-up to UnMoney as an expense
- Installable (PWA), light and dark theme, CSV export, delete account
- A superadmin dashboard for the owner only, with usage, AI cost and the switch that turns photo reading on per account (section 20)

AI reading is **off for every new account** until the superadmin turns it on. The superadmin always has it. An account without it can still add photos: they are kept with the fill-up, and the phone itself tries to read them, with no AI (section 21).

### Not in version 1

Listed in section 15 as later phases: other vehicle costs (service, insurance, tolls), reminders, GPS trip log, nearby fuel prices map, electric vehicles, miles and gallons, import from Fuelio, sharing a vehicle between accounts, native apps.

## 5. The main flow: a fill-up from photos

1. The rider opens Unfuel and taps **Add fill-up**. On a phone this is the large button on the home screen.
2. They take or pick photos. Any of these, in any order, up to four:
   - the printed **fuel bill**
   - the **pump display** (amount, litres, rate), for pumps that give no bill
   - the **odometer**
3. Unfuel asks for location permission the first time, with one line saying why ("to remember which station this was"). Saying no is fine; everything else still works.
4. Each photo is made smaller on the phone first (section 22), then the photos upload and the fill-up appears in the list straight away as "Reading…". The rider can close the app. Reading happens on the server.
5. A few seconds later the fill-up shows what was read: amount, litres, price per litre, date, station, odometer. If the numbers pass the checks (section 6) it is **saved without asking**, and a card offers **Edit** and **Undo**.
6. If something is missing or does not add up, the fill-up is marked **Needs a look** and opens on the one field to fix. It does not count in any figure until it is complete.
7. From the second fill-up on, the card also shows the result: "410 km on 9.43 L: 43.5 km/l, ₹2.44 per km".

### The same flow with no signal

1. Steps 1 to 3 are the same. The location comes from the phone's GPS, which does not need the internet.
2. The fill-up appears in the list as **Waiting for connection**, with its photos.
3. When the app is next open with a connection, the photos upload and are read without the rider doing anything. The fill-up keeps the date and place of capture, not of upload.
4. Nothing is deleted from the phone until the server has confirmed it has the fill-up.

### What "automatic" covers

Uploading resumes when the app is open or brought to the front. Browsers on iPhone do not let a closed web app upload in the background, so a queued capture waits until the app is next opened. The home screen shows a count of anything still waiting.

## 6. What the AI reads, and the checks

From the **bill or pump display**: amount paid, quantity (litres, or kg for CNG), price per litre, date and time, fuel product, station name, brand and address.

From the **odometer**: the total distance reading (not a trip meter).

Checks before a fill-up is saved without asking:

- **Amount, quantity and rate agree.** Any two give the third, so a bill with only an amount and a rate still works. If all three are printed and disagree by more than rounding, the fill-up needs a look.
- **The odometer moved forward** by a believable distance since the last fill-up of that vehicle.
- **The date is not in the future** and not more than a year old. With no readable date, the time the photo was taken is used.
- **The photo is what it claims to be.** A photo that is not a bill, pump or odometer is ignored, and the rider is told.

Only one photo? A bill alone saves the spend and litres and the fill-up joins the mileage sums at the next odometer reading. An odometer alone needs the amount typed (the last price per litre is filled in to help).

A photo is something to read, not to obey: text printed on a bill cannot instruct the app.

## 7. How mileage is worked out

Each fill-up has a **Full tank** switch (off by default until the rider turns it on once; after that it remembers their habit).

- **Exact.** Between two full-tank fill-ups, mileage is the distance between them divided by all the fuel added after the first one, up to and including the second. This is the standard method and what Fuelio uses.
- **Estimate.** For a rider who fills by amount, mileage for a stretch is the distance since the last fill-up divided by the fuel added at that last fill-up. Any single estimate can be off, because the tank is not at the same level each time, so the headline figure is the average over the last five stretches, and it is shown with "≈".
- **Overall.** Total distance divided by total fuel (leaving out the newest fill, which has not been burnt yet). Over many fill-ups this is accurate for both kinds of rider.
- **Missed a fill-up?** A switch on the fill-up says "I forgot to log one before this". That stretch is left out so one gap does not spoil the average.

Cost per km uses the same stretches: money spent on the fuel burnt divided by the distance.

After the first fill-up there is no mileage yet. The home screen says so plainly ("One more fill-up and you will see your mileage") and shows what is known: price per litre, litres, station.

## 8. Screens

| ID | Screen | What it is for |
| --- | --- | --- |
| S00 | Landing | Public page for people not signed in: what Unfuel does, the features, how it works in three steps, Continue with Google |
| S01 | Sign in | "Continue with Google", one line on what the app does, link to privacy |
| S02 | Home | Add fill-up button; headline mileage, cost per km, this month's spend; anything waiting or needing a look; latest fill-ups; one or two insight cards |
| S03 | Add fill-up | Camera or gallery; thumbnails of chosen photos; "Type it instead" |
| S04 | Fill-up | Photos, every field editable, Full tank and Missed switches, station, note, result for this stretch, Log in UnMoney, Delete |
| S05 | History | Fill-ups by month: date, station, amount, litres, mileage (exact or ≈); month totals |
| S06 | Stats | Charts and facts (section 9), period picker |
| S07 | Stations | List with visits, average price, mileage compared with the rider's average; station page with its fill-ups and Open in Maps |
| S08 | Vehicles | List, add, rename, archive; pick which one is current |
| S09 | More | Vehicles, Stations, units, theme, install the app, export CSV, sync status, privacy, sign out, delete account |
| S10 | Privacy | What is stored, who processes it (Convex, Vercel, Anthropic, Google) |
| S11 | Superadmin | Owner only: usage, AI cost and quality, AI access per account (section 20) |

Navigation: a bottom tab bar on phones (Home, History, Stats, More) with the Add button in the middle; a left sidebar from 768 px. From 1024 px, History and Stations show the chosen item in a panel beside the list. On a phone, forms open as a sheet from the bottom; on desktop, as a dialog.

Every screen has an empty state, a loading state and an offline state. No screen scrolls sideways at any width from 320 px up.

## 9. Charts and insights

Charts (Stats screen, per vehicle, for 3 months, 12 months or all time):

- Mileage per fill-up with the rolling average as a line; estimates drawn lighter than exact figures
- Cost per km over time
- Price per litre over time
- Spend per month
- Distance per month

Facts:

- Total spent, litres and distance
- Best and worst tank
- Average distance and days between fill-ups, average fill amount
- This month against last month
- Estimated range on a full tank (when tank size is set)
- About how much CO₂ the fuel produced

Insights, shown as cards on Home when they apply:

- **Mileage is dropping.** When the average of the last three stretches is 10% or more below the average of the stretches before them, say so, say since when, and suggest the usual causes (tyre pressure, air filter, service due, a change of route). The dip is marked on the mileage chart.
- **Mileage recovered** after a dip.
- **Fuel got dearer or cheaper** since the last fill-up, and what that adds per month at the rider's usual distance.
- **Station comparison** (section 10).

A note on a fill-up ("serviced", "highway trip") shows on the chart, so the rider can see what a change lines up with.

## 10. Location and stations

A station in Unfuel is a real fuel station, the one Google Maps knows, not just a name typed off a bill.

### 10.1 What is stored

- Each fill-up stores where it was captured: latitude, longitude and how accurate the fix was.
- Each fill-up points at a **station**. A station is tied to its Google place, so the same pump is the same station every time, whatever the bill calls it.

### 10.2 Picking the station automatically

When a fill-up is saved, Unfuel tries to name the exact station without asking:

1. **A station the rider has used before**, within about 150 m of this fill-up, is used straight away.
2. Otherwise Unfuel asks Google for fuel stations around the fill-up's location. If there is clearly one (a single station there, or one much nearer than the rest), it is selected. If there are several, the one whose name matches the bill ("HP", "Sri Sai Fuel Station") is selected.
3. With no location but a name and address read from the bill, Unfuel searches Google by that text and selects the result only if it clearly matches.
4. If it cannot tell, the station is left empty and the nearby candidates are offered first in the list.

The rider sees the selected station on the fill-up and can accept it by doing nothing.

### 10.3 The station field

On the fill-up form the station is a search box with a drop-down:

- It shows the detected station, with a cross to clear it.
- Opened, it lists the rider's own stations first (nearest first), then fuel stations near the fill-up.
- Typing searches Google for fuel stations by name, nearest first, as the rider types.
- A station that Google does not have (a small rural pump) can be added by its typed name.
- Results from Google are marked "Google Maps", as Google requires.

Changing a fill-up's station moves only that fill-up. Renaming a station renames it for every fill-up there.

### 10.4 Offline

Finding the station needs a connection. A fill-up saved offline keeps its location, and the station is found once it syncs. Offline, the drop-down still lists the rider's own stations.

### 10.5 What the rider learns

- For each station with three or more fill-ups: visits, average price per litre, and the mileage of the tanks filled there against the rider's overall average ("4% better than your average"). This is a hint, not proof, because tanks mix fuel from different stations; the screen says so.
- **Open in Maps** on a station opens that exact place.
- Stations are private to each account. Unfuel does not compare one rider's station with another's in version 1.

### 10.6 Two limits to know

- **Cost.** Google charges per search after a free monthly allowance. With an Indian billing account the allowance is 35,000 nearby searches and 70,000 type-ahead requests a month, far above what this needs; elsewhere it is 5,000 and 10,000. The superadmin dashboard shows the calls made.
- **Google's rules on keeping its data.** Google lets an app keep a place's ID for good, but not its name and address: those may only be held for a short time and fetched again. So Unfuel keeps the place ID permanently, shows Google's name from a copy it refreshes at least every 30 days, and always keeps what the bill itself said as the rider's own record. In practice the rider always sees a name. Decided on 2026-11-27: the refreshed copy.

## 11. Vehicles

The first vehicle is created without asking, named "My vehicle", with the fuel type taken from the first bill. It can be renamed at any time. Details are optional: type (bike, scooter, car), fuel (petrol, diesel, CNG), tank size.

With more than one vehicle, Home and Stats show the current one, with a switcher at the top. A new fill-up goes to the current vehicle; when a photo's odometer reading fits another vehicle far better, Unfuel asks which one it was.

## 12. UnMoney

A fill-up is also an expense. Unfuel can send it to UnMoney, either one at a time or every time.

- **Connecting.** In More › UnMoney the rider pastes their UnMoney link, a private address that UnMoney gives each account. That is the whole setup.
- **Automatic.** A switch, "Send every fill-up to UnMoney". When it is on, each fill-up is sent as soon as it is complete: amount, date, "Fuel" as the note, and a description such as "9.43 L petrol · My vehicle · HP Koramangala".
- **By hand.** With the switch off, a saved fill-up has a **Send to UnMoney** button.
- A fill-up is sent once. It then shows **Sent to UnMoney**. Editing the amount or date afterwards does not send it again; the rider is told so.
- If UnMoney cannot be reached, Unfuel tries again later and shows "Not sent yet" until it goes through.

The two apps stay separate: Unfuel only knows the link. This needs a matching change in UnMoney (the link, and what it does with an incoming fill-up), which is a separate piece of work in the UnMoney repo.

## 13. Typing it instead

"Type it instead" on the Add screen, and Edit on any fill-up, show the same form: date, odometer, amount, litres, price per litre (fill any two of the last three and the third is worked out), Full tank, station, note, optional photos. The last price per litre is offered as a starting point.

## 14. Feature list

| Feature | Area | Priority |
| --- | --- | --- |
| Sign in with Google | account | must |
| Fill-up from photos, read by AI | capture | must |
| Bill, pump display and odometer recognised in any order | capture | must |
| Saved without asking when checks pass; "Needs a look" otherwise | capture | must |
| Fill-up by hand; edit; delete with undo | capture | must |
| Offline capture, automatic upload and reading later | offline | must |
| Whole app readable offline from the last synced data | offline | must |
| Location saved with a fill-up | stations | must |
| Station detected from location and the bill, as a Google Maps place | stations | must |
| Station search drop-down (own stations, nearby, Google search as you type) | stations | must |
| Add a station Google does not have | stations | should |
| Station comparison: price and mileage | stations | should |
| Exact mileage between full tanks | figures | must |
| Estimated mileage for fills by amount | figures | must |
| Cost per km, spend per month | figures | must |
| Missed fill-up switch | figures | must |
| Mileage, cost, price, spend and distance charts | stats | must |
| Mileage dip and recovery insights | stats | must |
| Facts: best and worst tank, averages, month against month | stats | should |
| Range on a full tank, CO₂ | stats | could |
| More than one vehicle | vehicles | must |
| CNG in kg | vehicles | should |
| Send a fill-up to UnMoney with one tap | UnMoney | must |
| Send every fill-up to UnMoney automatically (a setting) | UnMoney | must |
| Public landing page with the features | app | must |
| Superadmin can see the photos of reads that failed or were corrected | admin | must |
| Installable on Android, iPhone and desktop | app | must |
| Light, dark and system theme (UnMoney's look) | app | must |
| No sideways scroll from 320 px to desktop | app | must |
| CSV export | data | should |
| Delete account and all data | data | must |
| Share photos to Unfuel from the gallery (Android) | app | could |
| Superadmin dashboard, one email only | admin | must |
| AI access switch per account, off by default | admin | must |
| AI cost by day, account, feature and model | admin | must |
| Usage, devices, feature adoption, storage, users table with drill-down | admin | must |
| AI read quality: saved untouched, needed a look, corrected, failed | admin | should |
| Photos can be added and kept by every account, AI or not | capture | must |
| Every photo optimised on the device before upload; nothing larger is ever stored | capture | must |
| Date and place taken from the photo itself | capture | must |
| Bill read on the device with no AI: amount, litres, rate, date | capture | must |
| Station name and brand read from the bill on the device with no AI | stations | must |
| Odometer read on the device with no AI, offered only when believable | capture | should |
| Device reading as the fallback when the AI cap is reached | capture | should |

## 15. Later phases

1. **Other costs**: service, insurance, tolls, parking; total cost of ownership.
2. **Reminders** by date or by odometer: service, insurance, pollution certificate.
3. **Units**: miles, gallons, mpg, l/100 km everywhere.
4. **Import** from Fuelio's CSV and other apps.
5. **A map** of the rider's stations; comparing a station across riders.
6. **Background upload** on Android when the app is closed.
7. **GPS trip log** and **nearby fuel prices**: large, and prices need a paid data source.
8. **Electric vehicles**: charging sessions and kWh.

## 16. How we will know it works

- A new user saves their first fill-up within a minute of signing in.
- Eight in ten photo fill-ups are saved without any typing.
- No capture made offline is ever lost: tested on every release.
- A rider who only fills by amount sees a mileage figure after their second fill-up.

## 17. Decisions already made

| Question | Decision |
| --- | --- |
| How much of Fuelio in version 1 | Fuel only; other modules later |
| Mileage for riders who fill by amount | Exact and estimated, chosen per fill-up by the Full tank switch |
| Offline approach | UnSplit's cache and queue, extended to hold photos |
| UnMoney | One-tap hand-off in version 1 |
| Sign-in | Google only |
| Look | UnMoney's theme to start with |
| AI access | Off for every account until the superadmin turns it on; the superadmin always has it |
| Superadmin | One email, `vik.bhat223@gmail.com`; dashboard at least as rich as UnMoney's |
| Accounts without AI | Photos still upload and are kept; the device reads what it can, station name included |
| Photo size | Optimised on the device before upload: smallest file with no visible loss, not pixel-exact |
| Stations | Real Google Maps places, detected automatically where possible, with a search drop-down to change them |
| Google's station name | Place ID kept for good; Google's name held as a copy refreshed at least every 30 days; the bill's own name kept as the rider's record |

## 18. Confirmed assumptions

Confirmed on 2026-11-27. These now stand as decisions alongside section 17.

1. **Save without asking** when the checks pass, with Edit and Undo, instead of a confirm step every time.
2. **"The UI SDK from Vercel"** is taken to mean shadcn/ui with the Geist typeface, which is what UnMoney and UnSplit already use.
3. **Kilometres and litres only** in version 1 (km/l, with l/100 km as a display option); currency picked from the first bill, rupees by default.
4. **Anyone with a Google account can sign up.** AI reading is off until the superadmin turns it on for the account (changed on 2026-11-27; it was on for everyone), and capped at 60 fill-ups a month for accounts that have it.
5. **Photos are kept** with the fill-up so the rider can check a reading later. They are deleted with the fill-up or the account.
6. **Stations are private** to each account, even though each is now tied to a Google place.
7. **Address**: `unfuel.vikrantbhat.com`.

## 19. Open questions

1. Sample photos: to come once the app is built. Until then the AI model is `claude-haiku-5-5`, as UnMoney uses for photos, and the device reader's rules are untested on real bills.

Answered on 2026-11-27:

| Question | Answer |
| --- | --- |
| Share a vehicle between accounts | No |
| UnMoney hand-off automatic | Yes, as a setting (section 12) |
| Public landing page | Yes, with the features (S00) |
| "Ask for photo reading" button | Dropped. It was my addition: a button for accounts without AI to ask the superadmin for it |
| Superadmin sees photos of failed reads | Yes (section 20.4) |
| Station search switched per account | No, on for everyone |

## 20. Superadmin dashboard and AI access

### 20.1 Who can open it

One account: `vik.bhat223@gmail.com`, the same address UnMoney's dashboard uses. It lives at `/admin` and is linked from More for that account only. Everyone else is sent back to Home before the page's code is even downloaded, and the server refuses every dashboard request from any other account.

### 20.2 AI access

- Photo reading is **off for every account** until the superadmin turns it on. The superadmin always has it.
- The dashboard lists every account with a switch, and can turn several on or off at once.
- **An account without it** still gets the whole app, photos included: Add fill-up takes photos the same way, they are stored with the fill-up, and the phone tries to read them itself (section 21). What it finds is filled into the form for the rider to check; the rest is typed. A line on the Add screen says AI reading is not on for this account.
- **When it is turned on**, the next photos are read. Photos already attached to earlier fill-ups can be read one at a time with a Read photos button on the fill-up.
- **When it is turned off**, nothing is lost: fill-ups stay, and reads in progress finish.
- The monthly cap of 60 reads applies to every account that has it. Hitting it falls back to typing.

### 20.3 What it shows

The same seven tabs as UnMoney's dashboard, with the same filters kept in the address (period of 7 days, 30 days, 90 days or a year; one account; platform; installed or browser; include yourself).

| Tab | What is on it |
| --- | --- |
| Overview | Tiles with change against the period before: active users, opens, minutes in app, fill-ups added, sign-ups, total users, AI cost. One chart over time with a metric picker. A Health card of things worth a look. Retention by sign-up week. |
| AI | Access switches. Reads that went wrong, with their photos. Cost per day, by feature, by account and by model. Tokens in and out. Average cost and tokens per read. Spend so far this month and where it is heading. Accounts near or at the monthly cap. **Read quality** (below). |
| Usage | When people open the app (weekday by hour), when fill-ups get logged, session length, screens visited. |
| Devices | Platforms, installed or browser, phone or desktop, browsers, app versions still in use and how many are behind. |
| Features | Who uses what: photo reading, typing only, more than one vehicle, stations, location allowed or refused, full-tank riders against amount riders, UnMoney hand-off, export, notes. How fill-ups come in. Vehicles by type and fuel. Currency, theme and unit choices. |
| Data | Bandwidth per day, storage by account, storage by table, photo storage and how much optimising saved. Google Places calls per day by type and by account, against the free monthly allowance. Offline: captures queued with no signal, how long they waited, any that could not sync. |
| Users | Sortable table: name, email, joined, last seen, opens, time in app, fill-ups, vehicles, AI on or off, AI cost, storage, app version. Tap one for a panel with their own tiles, minutes per day, devices, AI reads and cost, what they keep, latest sessions. Leaderboards. |

**Read quality** is what this dashboard adds over UnMoney's, because photo reading is the product:

- Of all reads: saved without any typing, needed a look, unreadable, failed after retries
- Which check fails most (amounts disagree, odometer went backwards, no date, and so on)
- Which fields riders correct after a read, and how often (amount, litres, odometer, date, station)
- Photos per read, and how many were a bill, a pump display or an odometer
- Time from upload to result, typical and slowest
- Retries, refusals, reads stopped by the cap
- All of it per model, so a change of model shows up as a before and after

This is also how the target in section 16 (eight in ten photo fill-ups saved without typing) is measured.

### 20.4 What it shows of a rider's own data

Counts and sizes, with one exception. The dashboard shows who the accounts are (name, email, picture) and how they use the app, not what is in their log: no amounts, odometer readings, station names, locations or notes.

**The exception: reads that went wrong.** For a photo read that needed a look, was unreadable, failed, or was corrected by the rider afterwards, the superadmin can open the read and see its photos, what the AI read, which check failed and what the rider changed. This is how wrong reads get fixed. The privacy page says so.

## 21. Photos without AI

Adding photos works for every account. What differs is who reads them.

| | With AI | Without AI |
| --- | --- | --- |
| Photos uploaded and kept with the fill-up | yes | yes |
| Who reads them | Claude, on the server | the rider's own phone or computer |
| Works with no signal | reading waits for a connection | reads straight away, once the reader has been downloaded |
| Saved without asking | when the checks pass | never: the form opens filled in, for the rider to check |
| What to expect | most fields, most of the time | the bill's numbers often; the station's name often on a clear print; the odometer sometimes |

### 21.1 What the device tries

1. **The photo's own details.** When and where it was taken, when the camera recorded that. This needs no reading at all and gives the date and the station's location.
2. **The bill's text.** The device reads the printed text and looks for the amount, the litres, the price per litre and the date by their labels. It uses the same check as the AI path: amount, litres and rate must agree. Numbers that agree are filled in. Numbers that do not are left blank, because a wrong number filled in quietly is worse than an empty field.
3. **The odometer.** The device looks for one long number. It is offered only when it is higher than the last reading and by a believable distance. Digital dashboards and photos with glare often defeat this; then the rider types it.

4. **The station's name.** Fuel bills print the station at the top: the oil company, then the dealer's name, then the address. The device takes the brand from a list of known companies (Indian Oil, Bharat Petroleum, HP, Shell, Nayara, Jio-bp and so on) and the name from the first clearly read line of the header that is not a brand, a title such as "Tax invoice", or a phone or tax number. It is offered as "HP · Sri Sai Fuel Station" for the rider to check or fix.

The name read from the bill is used to pick the right station among those Google finds nearby (section 10.2), and as the station's name when Google has no match. When the photo's location matches a station the rider already has, that station is used and the header is not needed.

A photo with no amount on it is tried as an odometer, so the rider does not have to say which photo is which.

### 21.2 What the rider sees

- The form opens with whatever was found. Each field the device filled is marked "from photo, check it".
- If nothing was found, the form is empty, the photos sit at the top to read from, and a line says so. Nothing is blocked.
- The fill-up is saved only when the rider taps Save.

### 21.3 Where else it is used

The same device reading is the fallback whenever AI will not read a photo: the monthly cap is reached, or the read failed after its retries. A "Try reading on this device" button on such a fill-up fills the form the same way.

### 21.4 Limits to be clear about

- The reader is a download of a few megabytes the first time a photo is added, then kept on the device. The very first use therefore needs a connection.
- It reads printed English text and digits. It cannot tell a trip meter from the odometer except by size.
- A station's name is a best guess from the top of the bill. A faded or crumpled header gives a wrong or empty name more often than a wrong number, since there is no sum to check a name against. The rider can rename a station at any time, and a rename applies to every fill-up there.
- Hand-written bills are not read.
- The photo is read on the device and is not sent to anyone to be read. It is still uploaded to be stored with the fill-up.

## 22. Photo size

Every photo, on every path (AI, device reading, or simply attached to a typed fill-up), is optimised on the rider's device before it is uploaded. The original never leaves the phone.

- **Resized** so its longest side is 1,568 pixels. A phone photo is about 4,000 pixels wide; a bill or an odometer stays fully readable at this size, and it is the size the AI reads at.
- **Re-encoded once** as WebP (JPEG on browsers that cannot write WebP), at a quality where the result cannot be told from the original by eye.
- **Stripped** of the camera's hidden details (location, device model) after the date and place have been read from them, so they are not stored twice or leaked with the file.
- **Never made worse to no purpose**: if the optimised copy is not smaller than the original, the original is used as it is.
- **Never compressed a second time**: the server stores exactly the bytes it receives.

A typical 3 to 5 MB phone photo should come out at roughly 150 to 400 KB. That is an estimate to confirm on the sample photos.

**On "lossless".** A strictly lossless copy of a camera photo (every pixel identical) is several times *larger* than the phone's own file, not smaller, so it cannot also be the smallest. What is specified here is the smallest file with no visible loss: all the saving comes from dropping pixels beyond what reading needs and from a better format. Decided on 2026-11-27: no visible loss, and pixel-exact originals are not kept.

The server refuses anything that is not an image or is over 2 MB, so a photo that skipped this step cannot be stored. Reading on the device (section 21) uses the original, before it is optimised, since it is already on the phone.
