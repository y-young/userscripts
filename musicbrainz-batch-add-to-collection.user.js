// ==UserScript==
// @name              MusicBrainz Batch Add to Collection
// @namespace         https://github.com/y-young/userscripts
// @version           2021.9.4
// @description       Batch add entities to MusicBrainz collection and copy MBIDs from entity pages, search result or existing collections.
// @author            y-young
// @licence           MIT; https://opensource.org/licenses/MIT
// @supportURL        https://github.com/y-young/userscripts/labels/mb-batch-add-to-collection
// @downloadURL       https://github.com/y-young/userscripts/raw/master/musicbrainz-batch-add-to-collection.user.js
// @include           /^https?:\/\/(.*\.)?musicbrainz.org\/(artist|collection|label|release|release-group|series|work)\/[\w-]{32,}(\/disc\/.*)?\/?(\?page=\d+|\?order=\w+)?$/
// @include           /^https?:\/\/(.*\.)?musicbrainz.org\/area\/[\w-]+\/(artists|events|labels|releases|recordings|places|works)\/?(\?page=\d+)?$/
// @include           /^https?:\/\/(.*\.)?musicbrainz.org\/artist\/[\w-]+\/(events|releases|recordings|works)\/?(\?page=\d+)?$/
// @include           /^https?:\/\/(.*\.)?musicbrainz.org\/place\/[\w-]+\/events\/?(\?page=\d+)?$/
// @include           /^https?:\/\/(.*\.)?musicbrainz.org\/search\?query=.*&type=(artist|event|label|instrument|place|recording|release_group|release|series|work)/
// @grant             GM_setClipboard
// @run-at            document-idle
// @name:zh-CN        MusicBrainz批量添加收藏
// @description:zh-CN 从条目页面、搜索结果或现有收藏页面批量复制MBID或添加项目到MusicBrainz收藏。
// ==/UserScript==

'use strict';

// To enable "Copy MBIDs" button, set this option to true
const SHOW_COPY_BUTTON = false;
// Whether to close dialog when successfully submitted
const CLOSE_DIALOG_AFTER_SUBMIT = true;

const IDENTIFIER = "batch-add-to-collection";
const CLIENT = "BatchAddToCollection/2021.9.1(https://github.com/y-young)";
const ENTITY_TYPE_MAPPING = {
    artist: "release-group",
    label: "release",
    place: "event",
    "release-group": "release",
    release: "recording",
    work: "recording"
};
const SUPPORTED_TYPES = [
    "artist", "event", "label", "instrument", "place",
    "recording", "release", "release-group",
    "series", "work"
];
const DIALOG_LOADING_NOTICE = `
    <div class="banner loading-message" style="background-position: right;">
        Loading your collections...
    </div>
`;

const url = new URL(location.href);
const origin = url.origin;
const path = url.pathname.split('/');

// Determine entity type of current page and target collection type
const entityType = path[1];
let collectionType = ENTITY_TYPE_MAPPING[entityType];
switch (entityType) {
    case "area":
    case "artist": {
        const subType = path[3];
        if (subType) {
            // Convert plural form to singular form
            collectionType = subType.substr(0, subType.length - 1);
        }
        break;
    }
    case "search":
        collectionType = url.searchParams.get("type");
        if (collectionType === "release_group") {
            collectionType = "release-group";
        }
        break;
    case "collection": {
        const type = document.querySelector("dd[class='type']").innerText;
        collectionType = type.toLowerCase().replaceAll(' ', '-');
        if (collectionType === "owned-music" || collectionType === "wishlist") {
            collectionType = "release";
        } else if (collectionType === "attending" || collectionType === "maybe-attending") {
            collectionType = "event";
        }
        break;
    }
    case "series": {
        const type = document.querySelector("dd[class='type']").innerText;
        collectionType = type.toLowerCase().replaceAll(' ', '-').replaceAll("-series", "");
        break;
    }
}
let collections = undefined;

// Initialize "Batch add to collection" dialog
const dialogElement = document.createElement("div");
dialogElement.id = IDENTIFIER + "-dialog";
dialogElement.title = "Batch add to collection";
dialogElement.innerHTML = DIALOG_LOADING_NOTICE;
dialogElement.style.overflow = "auto";
document.querySelector("body").appendChild(dialogElement);
const dialog = $("#" + IDENTIFIER + "-dialog").dialog({
    autoOpen: false,
    height: 400,
    width: 350,
    open: function() {
        loadCollections();
    },
    buttons: {
        Refresh: function() {
            collections = undefined;
            dialogElement.innerHTML = DIALOG_LOADING_NOTICE;
            loadCollections();
        },
        Cancel: function() {
            $(this).dialog("close");
        }
    }
});

function request(url, options = {}) {
    return fetch(origin + url, {
        ...options,
        headers: {
            "user-agent": CLIENT,
            "accept": "application/json"
        }
    });
}

function getGidFromUrl(url) {
    const path = new URL(url).pathname.split('/');
    return path[2];
}

function getCollectionTypePlural() {
    if (collectionType === "series") {
        return "series";
    }
    return collectionType + "s";
}

function createCheckbox(recordingId) {
    const checkbox = document.createElement("input");
    checkbox.setAttribute("type", "checkbox");
    checkbox.classList.add(IDENTIFIER);
    checkbox.dataset.id = recordingId;
    const cell = document.createElement("td");
    cell.prepend(checkbox);
    return cell;
}

function getSelectedIds() {
    const entityIds = Array.from(
        document.querySelectorAll("input:checked[type='checkbox']." + IDENTIFIER)
    ).map(checkbox => checkbox.dataset.id);
    return entityIds;
}

function addToCollection(event) {
    let target = event.target;
    // Compatibility with katakana-terminator
    if (target.nodeName === "RUBY") {
        target = target.parentElement;
    } else if (target.nodeName === "RT") {
        target = target.parentElement.parentElement;
    }

    const collectionId = target.dataset.id;
    const ids = getSelectedIds();
    if (ids.length === 0) {
        alert("No item is selected.");
        dialog.dialog("close");
        return;
    }
    if (ids.length > 400) {
        alert("Too many items, you can select at most 400 items.");
        dialog.dialog("close");
        return;
    }
    const loadingNotice = document.querySelector("#" + IDENTIFIER + "-dialog div.loading-message");
    loadingNotice.style.display = "block";
    request(
        `/ws/2/collection/${collectionId}/${getCollectionTypePlural()}/${ids.join(';')}?client=${encodeURIComponent(CLIENT)}`,
        {method: "PUT"}
    ).then(response => {
        loadingNotice.style.display = "none";
        if (response.status === 200) {
            alert(`Successfully added ${ids.length} item(s) to collection.`);
            if (CLOSE_DIALOG_AFTER_SUBMIT) {
                dialog.dialog("close");
            }
        } else {
            alert("An error occurred.");
            console.error(response);
        }
    });
}

function loadCollections() {
    if (collections) {
        return collections;
    }
    return request("/ws/2/collection")
        .then(response => response.json())
        .then(data =>
            data.collections.filter(
                collection =>
                    collection["entity-type"] === (collectionType === "release-group" ? "release_group" : collectionType)
            ).sort((a, b) => {
                if (a.name < b.name) {
                    return -1;
                }
                if (a.name > b.name) {
                    return 1;
                }
                return 0;
            })
        )
        .then(result => {
            collections = result;
            document.querySelector("#" + IDENTIFIER + "-dialog").innerHTML = `
            <div>You have the following ${collectionType} collection(s), click to add selected items:</div>
            <div class="banner loading-message" style="background-position: right; display: none;">
                Adding to collection...
            </div>
            <table class="tbl">
                <thead>
                    <th>Name</th>
                    <th>Action</th>
                </thead>
                <tbody>
                    ${result.map((collection, index) => `
                    <tr class="${index % 2 ? "odd" : "even"}">
                        <td>
                            <a href="/collection/${collection.id}" target="_blank" rel="noreferrer">
                                ${collection.name}
                            </a>
                        </td>
                        <td>
                            <a name="add" data-id="${collection.id}" href="javascript:void(0)">
                                Add
                            </a>
                        </td>
                    </tr>`).join('')}
                    <tr>
                        <td>
                            <a href="/collection/create" target="_blank" rel="noreferrer">
                                Create a new collection
                            </a>
                        </td>
                    </tr>
                </tbody>
            </table>`;
            document.querySelectorAll("#" + IDENTIFIER + "-dialog a[name='add']")
                .forEach(element => element.addEventListener("click", addToCollection));
        });
}

function toggleSelection(event) {
    const target = event.target;
    let context = target;
    while (context.nodeName !== "TABLE") {
        context = context.parentNode;
    }
    const checked = target.checked;
    context.querySelectorAll("input[type='checkbox']." + IDENTIFIER).forEach(checkbox => {
        checkbox.checked = checked;
    });
}

function createToggleSelectionCheckbox() {
    const headCell = document.createElement("th");
    const checkbox = document.createElement("input");
    checkbox.setAttribute("type", "checkbox");
    checkbox.addEventListener("click", toggleSelection);
    headCell.appendChild(checkbox);
    headCell.className = "checkbox-cell";
    return headCell;
}

function initTableCheckboxes(table) {
    // Get rows
    const rows = Array.from(table.querySelectorAll("tr.odd, tr.even"));
    rows.forEach(row => {
        const entityLink = row.querySelector(`td a[href^='/${collectionType}']`);
        if (!entityLink) {
            // Some rows in search result are grouped together
            row.prepend(document.createElement("td"));
            return;
        }
        const gid = getGidFromUrl(entityLink.href);
        // Use existing checkboxes if possible
        const checkbox = row.querySelector("td input[type='checkbox']");
        if (checkbox) {
            checkbox.classList.add(IDENTIFIER);
            checkbox.dataset.id = gid;
        } else {
            row.prepend(createCheckbox(gid));
        }
    });
    // Update table headers
    switch (entityType) {
        case "release":
            table.querySelectorAll("thead th[colspan]").forEach(header => {
                header.setAttribute("colspan", Number(header.getAttribute("colspan")) + 1);
            });
            table.querySelectorAll("tr.subh").forEach(header => {
                header.prepend(createToggleSelectionCheckbox());
            });
            break;
        case "work":
            table.querySelectorAll("tr.subh th[colspan]").forEach(header => {
                header.setAttribute("colspan", "5");
            });
            table.querySelector("thead tr").prepend(createToggleSelectionCheckbox());
            break;
        case "search":
        case "series":
            table.querySelector("thead tr").prepend(createToggleSelectionCheckbox());
            break;
        case "collection":
            if (!table.querySelector("thead th input[type='checkbox']")) {
                table.querySelector("thead tr").prepend(createToggleSelectionCheckbox());
            }
            break;
    }
}

function initCheckboxes() {
    document.querySelectorAll("table.tbl").forEach(table => {
        initTableCheckboxes(table);
    });
}

function openDialog() {
    dialog.dialog("open");
}

function copyMBIDs() {
    const entityIds = getSelectedIds();
    GM_setClipboard(entityIds.join("\n"));
    // temporarily replace the button text with a status message
    const previousText = this.innerText;
    this.innerText = `Copied ${entityIds.length} MBIDs`;
    setTimeout(() => this.innerText = previousText, 1000);
}

function initButton() {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.innerText = "Batch add to collection";
    button.addEventListener("click", openDialog);

    const copyButton = document.createElement("button");
    copyButton.setAttribute("type", "button");
    copyButton.innerText = "Copy MBIDs";
    copyButton.title = `Copies MBIDs to clipboard.`;
    copyButton.addEventListener("click", copyMBIDs);

    let container = document.querySelector("form div.row span.buttons");
    if (container) {
        container.appendChild(button);
        if (SHOW_COPY_BUTTON) {
            container.appendChild(copyButton);
        }
    } else {
        container = document.createElement("form");
        container.innerHTML = `<div class="row"><span class="buttons"></span></div>`;
        const tables = document.querySelectorAll("table.tbl");
        // Insert after the last table if there're multiple ones
        const precedent = tables[tables.length - 1];
        if (!precedent) {
            // Empty collection
            return;
        }
        container.querySelector("span.buttons").appendChild(button);
        if (SHOW_COPY_BUTTON) {
            container.querySelector("span.buttons").appendChild(copyButton);
        }
        precedent.parentNode.insertBefore(container, precedent.nextSibling);
    }
}

console.log("[Batch add to collection]", entityType, collectionType);
if (SUPPORTED_TYPES.includes(collectionType)) {
    initCheckboxes();
    initButton();
}
