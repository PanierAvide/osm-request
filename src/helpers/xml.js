import { parseString, Builder } from 'xml2js';
import packageJson from '../../package.json';

const osmRequestVersion = packageJson.version;

/**
 * Escape a string to make it XML parameter-safe
 * @param {string} str
 * @return {string}
 */
export function encodeXML(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a stringified OSM changeset
 * @param {string} [createdBy]
 * @param {string} [comment]
 * @param {string} [optionalTags] Keys values to set tags
 * @return {string}
 */
export function buildChangesetXml(
  createdBy = '',
  comment = '',
  optionalTags = {}
) {
  const tags = Object.entries(optionalTags).map(entry => {
    return `<tag k="${entry[0]}" v="${encodeXML(String(entry[1]))}"/>`;
  });
  return `
    <osm>
      <changeset>
        <tag k="created_by" v="${encodeXML(createdBy)}"/>
        <tag k="created_by:library" v="OSM Request ${osmRequestVersion}"/>
        <tag k="comment" v="${encodeXML(comment)}"/>
        ${tags.join(`\n        `)}
      </changeset>
    </osm>
  `;
}

/**
 * Build an OSM changeset from keys values, intended for update
 * @param {Object} tags To set tags
 * @param {string} [createdBy]
 * @param {string} [comment]
 * @return {string}
 */
export function buildChangesetFromObjectXml(
  tags = {},
  createdBy = '',
  comment = ''
) {
  const tagsArray = Object.entries(tags).map(entry => {
    return `<tag k="${entry[0]}" v="${encodeXML(String(entry[1]))}"/>`;
  });
  return `
    <osm>
      <changeset>
        <tag k="created_by" v="${encodeXML(createdBy)}"/>
        <tag k="created_by:library" v="OSM Request ${osmRequestVersion}"/>
        <tag k="comment" v="${encodeXML(comment)}"/>
        ${tagsArray.join(`\n        `)}
      </changeset>
    </osm>
  `;
}

/**
 * Build an OSM preferences XML from object keys values
 * @param {Object} prefs The preferences values
 * @return {string}
 */
export function buildPreferencesFromObjectXml(prefs) {
  const preferences = Object.entries(prefs).map(entry => {
    return `<preference k="${entry[0]}" v="${encodeXML(String(entry[1]))}"/>`;
  });
  return `
    <osm>
      <preferences>
        ${preferences.join(`\n        `)}
      </preferences>
    </osm>
  `;
}

/**
 * Convert a raw Element API response into a well formatted JSON object
 * @param {string} xml - The raw API response
 * @param {string} elementType - The type of the concerned OSM element (eg: node, way, relation)
 * @param {string} elementId - The ID of the concerned OSM element
 * @return {Promise}
 */
export function convertElementXmlToJson(xml, elementType, elementId) {
  return xmlToJson(xml).then(result => {
    const element = result.osm[elementType][0];
    element._id = elementId;
    element._type = elementType;
    return element;
  });
}

/**
 * Convert a JSON object with OSM map features into a well formatted JSON object
 * @param {Object} osmMapJson - The raw API response
 * @return {Array}
 */
export function cleanMapJson(osmMapJson) {
  const { bounds } = osmMapJson.osm;
  const mapper = type => e => ({ ...e, _id: e['$'].id, _type: type });

  let way = [];
  if (osmMapJson.osm.way) {
    way = osmMapJson.osm.way.map(mapper('way'));
  }
  let node = [];
  if (osmMapJson.osm.node) {
    node = osmMapJson.osm.node.map(mapper('node'));
  }
  let relation = [];
  if (osmMapJson.osm.relation) {
    relation = osmMapJson.osm.relation.map(mapper('relation'));
  }

  const newOsmObject = {};
  Object.entries({ node: node, way: way, relation: relation }).map(entry => {
    if (entry[0] in osmMapJson.osm) {
      newOsmObject[entry[0]] = entry[1];
    }
  });

  if (bounds) {
    newOsmObject.bounds = bounds;
  }
  return newOsmObject;
}

/**
 * Convert a raw list of elements API response into a well formatted JSON object
 * @param {string} xml - The raw API response
 * @param {string} type The OSM element type (node, way, relation)
 * @return {Promise}
 */
export function convertElementsListXmlToJson(xml, type) {
  return xmlToJson(xml).then(result => {
    return result.osm[type]
      ? result.osm[type].map(e => {
          e._id = e.$.id;
          e._type = type;
          return e;
        })
      : [];
  });
}

/**
 * Convert a raw Notes API response into a well formatted JSON object
 * @param {string} xml - The raw API response
 * @return {Promise}
 */
export function convertNotesXmlToJson(xml) {
  return xmlToJson(xml)
    .then(result => {
      if (result.osm.note) {
        return result.osm.note;
      } else {
        return [];
      }
    })
    .then(notes =>
      notes.map(note => {
        const returnedNote = flattenAttributes(note);

        returnedNote.comments = [
          ...returnedNote.comments.comment.map(comment =>
            flattenAttributes(comment)
          )
        ];

        return returnedNote;
      })
    );
}

/**
 * Convert a raw User API response into a well formatted JSON object
 * @param {string} xml - The raw API response
 * @return {Promise}
 */
export function convertUserXmlToJson(xml) {
  return xmlToJson(xml).then(result => {
    const user = flattenAttributes(result.osm.user[0]);
    Object.entries(user)
      .filter(e => e[1].$)
      .forEach(e => {
        user[e[0]] = flattenAttributes(e[1]);
      });
    if (user.blocks.received) {
      user.blocks.received = user.blocks.received.map(b =>
        flattenAttributes(b)
      );
    }
    return user;
  });
}

/**
 * XML converted with the xmlToJson function contain some weird objects
 * Eg:
 * {
 *   $: {
 *     attribute1: 'value1',
 *     attribute2: 'value2'
 *   },
 *   attribute3: ['value3'],
 *   attribute4: ['value4'],
 * }
 *
 * That function flatten them
 * Eg:
 * {
 *   attribute1: 'value1',
 *   attribute2: 'value2',
 *   attribute3: 'value3',
 *   attribute4: 'value4',
 * }
 *
 * @param {Object} object
 * @return {Object}
 */
export function flattenAttributes(object) {
  const flatObject = {
    ...object.$
  };

  Object.keys(object).forEach(key => {
    if (key === '$') return;
    if (!object[key]) return;
    if (object[key].length === 0) return;

    flatObject[key] = object[key][0];
  });

  return flatObject;
}

/**
 * Convert a stringified XML into a JSON object
 * @param {string} xml
 * @return {Promise}
 */
export function xmlToJson(xml) {
  return new Promise((resolve, reject) => {
    parseString(xml, (err, result) => {
      if (err) reject(err);

      resolve(result);
    });
  });
}

/**
 * Convert a JSON object into a stringified XML
 * @param {Object} json
 * @return {string}
 */
export function jsonToXml(json) {
  const builder = new Builder({
    xmldec: {
      version: '1.0',
      encoding: 'UTF-8',
      standalone: null
    }
  });
  return builder.buildObject(json);
}
