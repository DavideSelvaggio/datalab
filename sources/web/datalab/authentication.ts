/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

/// <reference path="../../../externs/ts/node/node.d.ts" />
/// <reference path="../../../externs/ts/node/node-cache.d.ts" />
/// <reference path="common.d.ts" />


import http = require('http');
import httpapi = require('./httpapi');
import logging = require('./logging');
import NodeCache = require("node-cache");

/**
 * The cache service for whitelisted user.
 */
var authCache: NodeCache = new NodeCache();

/**
 * The application settings instance.
 */
var appSettings: common.Settings;

function getAccessTokenFromMetadataServer(cb: common.Callback<string>) {
  var headers: common.Map<string> = {'X-Google-Metadata-Request': 'True'};
  try {
    httpapi.get(appSettings.metadataHost, '/computeMetadata/v1/instance/service-accounts/default/token',
        null, null, headers, function(e: Error, data: any) {
      if (e) {
        logging.getLogger().error(e, 'Failed to get access token from metadata service.');
        cb && cb(e, null);
        return;
      }
      if (data && data.access_token) {
        cb && cb(null, data.access_token);
      }
      else {
        logging.getLogger().error('Failed to get access token metadata service response.');
        cb && cb(Error('metadata server'), null);
      }
    });
  }
  catch (e) {
    logging.getLogger().error(e, 'Failed to get access token from metadata service.');
    cb && cb(e, null);
  }
}

function lookupUserFromDatastore(userId: string, accessToken: string, cb: common.Callback<boolean>) {
  var postData: any = {
    keys: [
      {
        path: [
          {
            kind: 'DatalabUser',
            name: userId
          }
        ]
      }
    ]
  };
  var dataStorePath: string = '/datastore/v1beta2/datasets/' + appSettings.projectId + '/lookup';
  try {
    httpapi.posts('www.googleapis.com', dataStorePath, null, postData, accessToken, null, function(e: Error, data: any) {
      if (e) {
        logging.getLogger().error(e, 'Failed to query Datastore for authentication.');
        cb && cb(e, null);
        return;
      }
      var found: boolean = data && data.found && data.found.length > 0;
      if (found) {
        // Add user to cache and set expiration to 10 mintutes.
        authCache.set(userId, true, 600);
      }
      cb && cb(null, found);
    });
  } 
  catch (e) {
    logging.getLogger().error(e, 'Failed to query Datastore for authentication.');
    cb && cb(e, null);
  }
}

/**
 * Checks whether a given user has access to this instance of Datalab.
 */
export function checkUserAccess(userId: string, cb: common.Callback<boolean>) {
  if (!appSettings.enableAuth || authCache.get(userId)) {
    process.nextTick(function() {
      cb(null, true);
    });
    return;
  }
  getAccessTokenFromMetadataServer(function(e: Error, accessToken: string) {
    if (e) {
      cb && cb(e, false);
      return;
    }
    lookupUserFromDatastore(userId, accessToken, cb);
  });
}

/**
 * Get the authentication URL where users sign in.
 */
export function getAuthenticationUrl(request: http.ServerRequest): string {
  var authUrl: string = "https://datalab.cloud.google.com?startinproject="
            + appSettings.projectId + "&name=" + appSettings.instanceName;
  if (request.headers && request.headers.host) {
    // If we get the host of the request, we can reconstruct the URL current user is requesting.
    // Sending the URL to the launcher (deployer), so that it can go directly to the requested
    // page after signin. It also makes local run working (otherwise, the launcher will not
    // redirect user back to 127.0.0.1).
    // Using http for local run, while in cloud http will be redirected to https.
    authUrl += "&redirect=" + encodeURIComponent("http://" + request.headers.host + request.url)
  }
  return authUrl;
}

export function init(settings: common.Settings) : void {
  appSettings = settings;
}
