/**
 * Parser and schema for CloudFormation YAML template tags.
 *
 * There are some existing modules out there:
 *    https://github.com/yyolk/cloudformation-js-yaml-schema
 *    https://github.com/KoharaKazuya/js-yaml-schema-cfn
 * But both are poorly documented, with insufficient tests, and don't fully work.
 *
 * This implementation is based on the official AWS python client:
 * https://github.com/aws/aws-cli/blob/develop/awscli/customizations/cloudformation/yamlhelper.py
 */
 
import jsYaml from 'js-yaml';
import * as fs from 'fs';
import * as _ from 'lodash';

 /**
  * Split a string on the given separator just once, returning an array of two parts, or null.
  */
 const splitOne = (str: string, sep: string) => {
   let index = str.indexOf(sep);
   return index < 0 ? null : [str.slice(0, index), str.slice(index + sep.length)];
 };
 
 /**
  * Returns true if obj is a representation of a CloudFormation intrinsic, i.e. an object with a
  * single property at key keyName.
  */
 const checkType = (obj: any, keyName: string) => {
   return obj && typeof obj === 'object' && Object.keys(obj).length === 1 &&
     obj.hasOwnProperty(keyName);
 };
 
 
 const overrides: any = {
   // ShortHand notation for !GetAtt accepts Resource.Attribute format while the standard notation
   // is to use an array [Resource, Attribute]. Convert shorthand to standard format.
   GetAtt: {
     parse: (data: any) => typeof data === 'string' ? splitOne(data, '.') : data,
     dump: (data: any) => data.join('.')
   }
 };
 
 const applyOverrides = (data: any, tag: any, method: any) => {
   return overrides[tag] ? overrides[tag][method](data) : data;
 };
 
 /**
  * Generic tag-creating helper. For the given name of the form 'Fn::Something' (or just
  * 'Something'), creates a js-yaml Type object that can parse and dump this type. It creates it
  * for all types of values, for simplicity and because that's how the official Python version
  * works.
  */
 const makeTagTypes = (name: any) => {
   const parts = splitOne(name, '::');
   const tag = parts ? parts[1] : name;
   // Translate in the same way for all types, to match Python's generic translation.
   return ['scalar', 'sequence', 'mapping'].map((kind: any) => new jsYaml.Type('!' + tag, {
     kind: kind,
     construct: (data: any) => ({[name]: applyOverrides(data, tag, 'parse')}),
     predicate: (obj: any) => checkType(obj, name),
     represent: (obj: any) => applyOverrides(obj[name], tag, 'dump'),
   }));
 };
 
 /**
  * This list is from
  * http://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html
  * Note that the Python version handles ANY tag that starts with ! in the same way (translating it
  * to Fn:: prefix, but js-yaml requires listing tags explicitly.
  */
 const supportedFunctions = [
   'Fn::Base64',
   'Fn::Cidr',
   'Fn::FindInMap',
   'Fn::GetAtt',
   'Fn::GetAZs',
   'Fn::ImportValue',
   'Fn::Join',
   'Fn::Select',
   'Fn::Split',
   'Fn::Sub',
   'Fn::Transform',
   'Ref',
   'Condition',
   'Fn::And',
   'Fn::Equals',
   'Fn::If',
   'Fn::Not',
   'Fn::Or',
 ];
 
 const allTagTypes = [];
 for (let name of supportedFunctions) {
   allTagTypes.push(...makeTagTypes(name));
 }
 
 
 /**
  * The actual js-yaml schema, extending the DEFAULT_SAFE_SCHEMA.
  */
 export const schema = jsYaml.CORE_SCHEMA.extend({
   implicit: [],
   explicit: allTagTypes,
 });
 
 
 /**
  * Convenience function to parse the given yaml input.
  */
 export const parse = (input: any) => jsYaml.load(input, { schema: schema });;
 
 /**
  * Convenience function to serialize the given object to Yaml.
  */
 export const dump = (input: any) => jsYaml.dump(input, { schema: schema });


export const updateCFYamlPropertyInplace = (pathToYaml: string, propertyPath: string, propertyValue: string) => {
  try {
    const doc: any = parse(fs.readFileSync(pathToYaml, 'utf8'));
    // console.log(`${doc}`);
    _.set(doc, propertyPath, propertyValue);
    fs.writeFileSync(pathToYaml, dump(doc));
  } catch (e) {
    console.log('--- ERROR: Could not perform yaml update. ---');
    console.log(JSON.stringify(e));
  }
};